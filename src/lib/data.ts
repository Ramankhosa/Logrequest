export const appNavigation = [
  {
    href: "/",
    label: "Overview",
    summary: "Platform direction, integrated modules, and Module 1 scope.",
  },
  {
    href: "/superadmin",
    label: "Superadmin",
    summary: "Tenant creation, owner provisioning, and entitlement control.",
  },
  {
    href: "/tenant-admin",
    label: "Tenant Admin",
    summary: "Tenant owner and admin workspace for user provisioning and identity policy.",
  },
  {
    href: "/imports",
    label: "Imports",
    summary: "Deferred staging workflow with schema support already in place.",
  },
  {
    href: "/insights",
    label: "Insights",
    summary: "Readable BI surfaces and assistive AI summaries.",
  },
];

export const shellHighlights = [
  {
    title: "Visible state",
    summary: "Tenant, user, invitation, and entitlement states are separate and explicit.",
  },
  {
    title: "Stepwise actions",
    summary: "Wizards and provisioning flows are split into low-cognitive-load stages.",
  },
  {
    title: "Safe operations",
    summary: "High-impact changes are designed for review-first workflows.",
  },
];

export const overviewStats = [
  {
    label: "Primary stack",
    value: "Next.js + Prisma",
    description: "App Router, Tailwind UI, and a Postgres-ready domain model.",
    accent: "brand" as const,
  },
  {
    label: "Provisioning mode",
    value: "Admin-first",
    description: "Users are intended to be provisioned and invited rather than self-signing up.",
    accent: "amber" as const,
  },
  {
    label: "Access control",
    value: "Deterministic",
    description: "Tenant state, entitlement state, user state, and membership state are modeled independently.",
    accent: "slate" as const,
  },
  {
    label: "Import readiness",
    value: "Deferred, modeled",
    description: "Upload batches and row staging remain in the schema so Excel and CSV can land later without rework.",
    accent: "rose" as const,
  },
];

export const integratedModules = [
  {
    name: "Prisma + PostgreSQL",
    summary: "Models tenants, policies, users, memberships, invitations, uploads, and audit records with room for future SSO and entitlement logic.",
  },
  {
    name: "Tailwind CSS",
    summary: "Supports a low-cognitive academic admin interface with strong visual hierarchy and responsive panels.",
  },
  {
    name: "React Hook Form + Zod",
    summary: "Drives stepwise admin forms with inline validation and data preservation between steps.",
  },
  {
    name: "TanStack Table",
    summary: "Powers a clean tenant user directory that can later expand into filters, exports, and inline workflows.",
  },
  {
    name: "Recharts",
    summary: "Provides business intelligence views for access health, adoption, entitlement mix, and operational risk.",
  },
  {
    name: "XLSX readiness",
    summary: "The parser dependency is already present, but the actual import UI is intentionally deferred for a later pass.",
  },
];

export const moduleOneCoverage = [
  {
    title: "Tenant lifecycle",
    status: "Active",
    description: "Draft, pending verification, grace period, suspended, revoked, and archived are modeled separately from entitlement.",
  },
  {
    title: "User + membership lifecycle",
    status: "Pending activation",
    description: "A global user can exist while access still depends on membership status, invitation state, and tenant posture.",
  },
  {
    title: "Bulk-import readiness",
    status: "Review required",
    description: "UploadBatch and UploadRow are already in the Prisma schema, so deferred staging can be added later without changing the provisioning model.",
  },
];

export const routeCards = [
  {
    key: "superadmin",
    href: "/superadmin",
    eyebrow: "Provisioning",
    title: "Superadmin control plane",
    description: "Guided tenant creation, protected owner logic, and entitlement-aware activation defaults.",
  },
  {
    key: "imports",
    href: "/imports",
    eyebrow: "Future import lane",
    title: "Deferred bulk-upload workflow",
    description: "A placeholder lane for Excel and CSV staging, with schema support already wired into the platform.",
  },
  {
    key: "insights",
    href: "/insights",
    eyebrow: "Business intelligence",
    title: "Readable academic dashboards",
    description: "Operational BI surfaces with AI-style briefings that explain what changed and what to do next.",
  },
];

export const superadminMetrics = [
  {
    label: "Active tenants",
    value: "126",
    description: "Institutions currently within an access-permitted lifecycle and entitlement state.",
    accent: "brand" as const,
  },
  {
    label: "Pending verification",
    value: "14",
    description: "Tenants created but still waiting for governance or subscription confirmation.",
    accent: "amber" as const,
  },
  {
    label: "Grace period",
    value: "08",
    description: "Tenants under temporary access rules pending subscription resolution.",
    accent: "slate" as const,
  },
  {
    label: "Policy holds",
    value: "03",
    description: "Institutions blocked because commercial state and security posture are incompatible.",
    accent: "rose" as const,
  },
];

export const tenantLifecycleSnapshot = [
  { label: "Active", value: "126", percent: 82 },
  { label: "Pending verification", value: "14", percent: 18 },
  { label: "Grace period", value: "8", percent: 11 },
  { label: "Suspended", value: "3", percent: 4 },
];

export const superadminQueue = [
  {
    title: "Northridge Institute billing hold",
    status: "Review required",
    description: "Subscription expired on 31 March 2026. Tenant remains in Grace Period until renewal approval is confirmed.",
  },
  {
    title: "Greenfield University ownership transfer",
    status: "Pending verification",
    description: "New owner identity is valid, but the protected owner handoff requires final governance approval.",
  },
  {
    title: "Atlas Research College reactivation",
    status: "Active",
    description: "Security hold has been cleared and the tenant is ready for invitation resend.",
  },
];

export const tenantAdminMetrics = [
  {
    label: "Active users",
    value: "2,481",
    description: "Tenant memberships with a user and tenant state that currently allow platform access.",
    accent: "brand" as const,
  },
  {
    label: "Invitations pending",
    value: "94",
    description: "Users provisioned by admin but not yet activated through the invitation flow.",
    accent: "amber" as const,
  },
  {
    label: "Locked accounts",
    value: "11",
    description: "Accounts temporarily blocked for reset, repeated login failure, or admin review.",
    accent: "rose" as const,
  },
  {
    label: "Approved login rules",
    value: "Exact match",
    description: "Social sign-in is limited to pre-approved institutional identity matches.",
    accent: "slate" as const,
  },
];

export type DirectoryRow = {
  name: string;
  email: string;
  role: string;
  status: string;
  invitation: string;
  lastAccess: string;
};

export const directoryRows: DirectoryRow[] = [
  {
    name: "Dr. Alina Morgan",
    email: "alina.morgan@nexford.edu",
    role: "TENANT_OWNER",
    status: "ACTIVE",
    invitation: "Accepted",
    lastAccess: "2026-03-16T11:20:00.000Z",
  },
  {
    name: "Kevin Sharma",
    email: "kevin.sharma@nexford.edu",
    role: "TENANT_ADMIN",
    status: "ACTIVE",
    invitation: "Accepted",
    lastAccess: "2026-03-15T08:42:00.000Z",
  },
  {
    name: "Mira Thompson",
    email: "mira.thompson@nexford.edu",
    role: "TENANT_USER",
    status: "PENDING_ACTIVATION",
    invitation: "Pending",
    lastAccess: "2026-03-10T10:00:00.000Z",
  },
  {
    name: "Julian Grant",
    email: "julian.grant@nexford.edu",
    role: "TENANT_USER",
    status: "SUSPENDED",
    invitation: "Accepted",
    lastAccess: "2026-02-27T14:30:00.000Z",
  },
];

export const invitationQueue = [
  {
    email: "mira.thompson@nexford.edu",
    role: "Research Coordinator",
    status: "Pending activation",
    description: "Invitation sent. User can sign in after password setup and tenant activation remain valid.",
  },
  {
    email: "omar.khan@nexford.edu",
    role: "Principal Investigator",
    status: "Invitation expired",
    description: "The activation link expired. Resend is available without recreating the user shell.",
  },
  {
    email: "j.sen@nexford.edu",
    role: "Faculty Reviewer",
    status: "Review required",
    description: "Social sign-in attempt used an unapproved email alias and was blocked for exact-match policy.",
  },
];

export const identityPolicies = [
  {
    title: "Google sign-in",
    state: "Enabled",
    description: "Allowed only when the verified Google email exactly matches the approved official email.",
  },
  {
    title: "Microsoft sign-in",
    state: "Enabled",
    description: "Provider binding is stored on first successful sign-in to prevent future identity ambiguity.",
  },
  {
    title: "Alias relaxation",
    state: "Review required",
    description: "Disabled by default. Tenant admins should not relax domain or alias matching without governance approval.",
  },
];

export const importRoadmap = [
  {
    title: "Batch staging tables ready",
    state: "Modeled",
    description: "UploadBatch and UploadRow can accept a deferred parser and validator without schema churn.",
  },
  {
    title: "Provisioning continuity",
    state: "Ready",
    description: "Imported users will still land in the same user, membership, invitation, and audit pipeline as manually created users.",
  },
  {
    title: "Parser UI",
    state: "Deferred",
    description: "The actual Excel and CSV upload interface has been postponed, but the dependency and architecture hooks remain available.",
  },
];

export const insightMetrics = [
  {
    label: "Monthly active users",
    value: "18.4k",
    description: "Usage is growing without a matching rise in blocked attempts, which indicates healthier provisioning quality.",
    accent: "brand" as const,
  },
  {
    label: "Blocked access attempts",
    value: "128",
    description: "Most failures map to pending activation or tenant payment hold rather than invalid credentials.",
    accent: "rose" as const,
  },
  {
    label: "Grace-period tenants",
    value: "9",
    description: "These institutions should surface clearly on admin dashboards rather than disappearing into generic subscription status labels.",
    accent: "amber" as const,
  },
  {
    label: "AI briefings generated",
    value: "31",
    description: "Summaries are positioned as operational briefings, not intrusive copilot messages.",
    accent: "slate" as const,
  },
];

export const insightTrend = [
  { month: "Oct", activeUsers: 10900, blockedAttempts: 184 },
  { month: "Nov", activeUsers: 11840, blockedAttempts: 170 },
  { month: "Dec", activeUsers: 13100, blockedAttempts: 162 },
  { month: "Jan", activeUsers: 14820, blockedAttempts: 154 },
  { month: "Feb", activeUsers: 16550, blockedAttempts: 139 },
  { month: "Mar", activeUsers: 18420, blockedAttempts: 128 },
];

export const roleAdoption = [
  { role: "Owners", count: 126 },
  { role: "Admins", count: 412 },
  { role: "Users", count: 18420 },
];

export const entitlementDistribution = [
  { label: "Paid active", value: 92 },
  { label: "Trial active", value: 21 },
  { label: "Grace period", value: 9 },
  { label: "Suspended", value: 4 },
];

export const aiBriefing = [
  {
    title: "Access health summary",
    summary: "Blocked sign-ins fell for the fourth straight month. The largest remaining cause is pending activation, which suggests invitation follow-through is the next workflow to optimize.",
  },
  {
    title: "Tenant operations summary",
    summary: "Three institutions are within grace-period rules. Two of them are still actively using the platform, so renewal intervention should be routed to tenant owners now instead of waiting for hard suspension.",
  },
  {
    title: "Provisioning quality summary",
    summary: "Bulk imports remain the main source of future scale efficiency, but the same invitation and membership rules should apply whether the user is created one-by-one or in bulk.",
  },
];

export const riskAlerts = [
  {
    title: "Suspension after login",
    summary: "If a tenant is suspended while a session is already active, the platform should invalidate the session during refresh and route the user to a blocked-access page with a readable reason.",
  },
  {
    title: "Cross-tenant identity collisions",
    summary: "Employee ID should be treated as tenant-scoped. Official email may be global, but the access decision still depends on a valid tenant membership plus entitlement.",
  },
  {
    title: "Social identity mismatch",
    summary: "New social accounts must never claim a membership by approximate email matching. Exact verified email match should stay the default.",
  },
];
