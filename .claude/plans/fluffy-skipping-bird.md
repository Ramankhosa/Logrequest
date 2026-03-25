# R5 — Unified Role-Based KRA/KPI Dashboard & Analytics

## Context

The KRA/KPI framework (R1–R4) is complete: KPI definitions, target allocations, staged achievements, two-step verification, reward calculation, state machine (DRAFT→PENDING→RELEASED→REVOKED), notifications, and audit trail all exist. What's missing is a **unified dashboard** that serves every person in the organization based on their **existing org role and hierarchy position** — from a faculty member tracking their own KPIs, to a Dean comparing schools, to the VC seeing the entire institution.

The system already has:
- `OrgUnit` tree with `parentId`, `level`, `path`, `category`
- `OrgRoleAssignment` with `isUnitHead`, `approvalAuthority`, `scope (NODE|DESCENDANTS)`
- `UserOrgAssignment` with `PRIMARY|SECONDARY` assignment types
- `getMyKpiContext()` returning `headOfUnits[]` and `memberOfUnits[]`
- `getApprovalChain()` walking up the tree
- `getUserAssignments()` and `getUnitMembers()` for role lookups
- Dashboard API routes: `/overview`, `/org-hierarchy`, `/kpi-comparison`, `/attention`, `/stage-bottleneck`, `/person`
- Recharts library installed
- UI: Tailwind CSS 4, TanStack React Table, Recharts, Lucide icons, custom `glass-panel` / `metric-card` / `status-badge` components
- Design tokens: `--brand: #0f766e` (teal), `--accent: #f59e0b` (amber), `--danger: #dc2626`, `--background: #f5f1e8` (warm cream)

**What's NOT yet used but exists in schema**: `scope (NODE|DESCENDANTS)` on role assignments, `approvalAuthority` flag on role definitions.

---

## Guiding Principles

> **1. No new role concepts.** Every dashboard view is determined by the user's existing `OrgRoleAssignment` entries — specifically `isUnitHead`, `approvalAuthority`, `scope`, and unit position in the hierarchy. A user who is unit head of "School of Engineering" with `scope: DESCENDANTS` automatically sees all departments under that school. A tenant admin sees everything.

> **2. Minimal cognitive load.** Dashboards must be usable by non-technical staff (faculty, administrative officers, department heads). Every design decision must reduce thinking, not add to it.

---

## Pre-Requisite: Hierarchy & Role Fixes

Before building dashboards, activate two schema fields that exist but are never enforced:

### P.1 Activate `scope (NODE|DESCENDANTS)` enforcement

**Current state**: Stored on `OrgRoleAssignment` but ignored in every query. Default is `NODE`.

**Change needed**: When assigning a unit head role, the admin sets scope:
- `NODE` = user sees only that specific unit's data
- `DESCENDANTS` = user sees that unit + all children recursively

**Files to modify**:
- `src/lib/org-structure/roles-service.ts` — in `assignRoleToUser()`, ensure `scope` is persisted from input (it already is). In `getUserAssignments()`, include `scope` in the returned `RoleAssignmentView` type.
- `src/lib/kra-kpi/my-kpi-service.ts` — in `getMyKpiContext()`, include `scope` in `headOfUnits[]` entries so downstream code knows whether to expand to descendants.

**No schema migration needed** — the field and enum already exist.

### P.2 Activate `approvalAuthority` enforcement

**Current state**: Column exists on `OrgRoleDefinition`, never checked anywhere.

**Change needed**: Use this flag to control who sees the Rewards tab and can perform bulk reward transitions. When creating/editing a role definition, admin can toggle `approvalAuthority: true`.

**Files to modify**:
- `src/lib/org-structure/roles-service.ts` — in `getUserAssignments()`, include `approvalAuthority` from the role definition in the returned view.
- `src/lib/kra-kpi/reward-ops-service.ts` — in `transitionContributorRewards()`, add authorization check: caller must have `approvalAuthority=true` on at least one role, OR be tenant admin.

### P.3 Ensure `OrgUnit.path` is populated

The `path` field on `OrgUnit` enables efficient `WHERE path LIKE 'ROOT/SCHOOL/%'` queries instead of BFS traversal. Verify it's populated during unit creation/move in `src/lib/org-structure/service.ts`. If not, add a migration/backfill script.

---

## UX Design System & Principles

All dashboard components MUST follow these principles. These are non-negotiable implementation rules for Codex.

### UX-1: Progressive Disclosure (Show Less, Reveal More)

- **Default view shows 3–5 key metrics only** — never dump 20 numbers on screen
- Details are accessed by clicking/expanding, never pre-loaded
- Tables show 5–7 columns max. Additional columns available via "More columns" toggle
- Charts show the most important series by default; others togglable via legend clicks
- Person detail is a **slide-over panel** (not a new page), so context is preserved

### UX-2: Information Hierarchy (Big → Small, Left → Right)

- **Summary cards at top** (the "glanceable" layer) — large numbers, color-coded
- **Primary data table below** (the "scannable" layer) — sortable, filterable
- **Charts alongside or below table** (the "analyzable" layer) — for patterns and trends
- **Detail panels on interaction** (the "investigable" layer) — slide-overs, expandable rows
- Visual weight: summary cards use `text-3xl font-bold`, tables use `text-sm`, chart labels use `text-xs`

### UX-3: Color Language (Consistent Everywhere)

| Color | Hex | Meaning | Use |
|-------|-----|---------|-----|
| Teal/Brand | `#0f766e` | On track / Good | Scores ≥80%, completed, released |
| Blue | `#2563eb` | In progress / Neutral | Scores 50–79%, submitted, pending |
| Amber | `#f59e0b` | Needs attention | Scores 25–49%, overdue <7 days, draft |
| Red/Rose | `#dc2626` | Critical / Failed | Scores <25%, rejected, revoked, overdue >7 days |
| Slate | `#64748b` | Inactive / N/A | Not started, no data |

These 5 colors are used in: score badges, progress bars, chart colors, status pills, heatmap cells. Never use arbitrary colors.

### UX-4: Contextual Wayfinding

- **Breadcrumb** always visible when inside the Organization tab — shows exactly where you are in the hierarchy
- **"You are here" indicator** on unit cards when viewing your own unit
- **Tab badges** show actionable counts (e.g., "Reviews (7)" shows 7 pending)
- **Period selector** is sticky at top-right, persists across tab switches
- **Back button / breadcrumb click** restores previous state exactly (URL-driven state)

### UX-5: Forgiving Interaction

- **No destructive actions without confirmation** — bulk reward transitions show a confirmation dialog with count + total amount
- **Undo support** where possible (e.g., "Mark all as read" shows "Undo" toast for 5 seconds)
- **Empty states are helpful** — not just "No data" but "No achievements submitted yet for this period. KPIs are allocated — submissions can begin."
- **Filters are visible and clearable** — active filters shown as pills above the table with ✕ to remove, plus "Clear all" link
- **No dead ends** — every empty state suggests an action or explains why it's empty

### UX-6: Loading & Feedback States

- **Skeleton loaders** for initial data fetch — gray animated placeholder shapes matching the layout (cards become gray rectangles, table rows become gray bars)
- **Inline spinners** for actions (approve, transition) — spinner replaces the button text, button becomes disabled
- **Success feedback** is inline and auto-dismissing (green banner, 3s) — not a popup
- **Error feedback** is persistent until dismissed (red banner with details)
- **Stale data indicator** — if data is >5 min old, show subtle "Last updated: 5 min ago · Refresh" link

### UX-7: Accessibility & Inclusivity

- All interactive elements have visible focus rings (outline-2 outline-offset-2 outline-brand)
- Color is **never the only indicator** — always paired with icon, text, or pattern (e.g., score badges show both color AND the number)
- Tables have proper `<th scope="col">` headers
- Charts include a data table fallback (expandable "View as table" link below each chart)
- Minimum touch target: 44×44px for mobile
- `aria-label` on icon-only buttons (e.g., drill-down arrow, filter clear)
- Keyboard navigation: Tab through table rows, Enter to drill down, Escape to close slide-over

### UX-8: Responsive Layout

- **Desktop** (≥1024px): Side-by-side panels, full data tables, charts beside tables
- **Tablet** (768–1023px): Stacked panels, condensed tables (fewer columns), charts below tables
- **Mobile** (< 768px): Single column, cards replace tables for summary, drill-down via cards not rows, charts simplified to mini sparklines
- Summary cards: 5-across on desktop, 3+2 on tablet, 2+2+1 on mobile
- Tables on mobile: use card-list pattern (each row becomes a card with label:value pairs)

### UX-9: Smart Defaults & Guided Entry

- **Period selector defaults to current active period** — no blank state on first load
- **Organization tab starts at user's highest-scope unit** — not the root (unless tenant admin)
- **Review queue sorted by staleness** (oldest first) — most urgent at top
- **Reward pipeline defaults to PENDING state** — the actionable items, not all states
- **Filters remember last selection within session** (URL params persist)
- **First-time user sees a brief orientation** — a dismissible banner: "This dashboard shows your team's KPI performance. Use the tabs above to switch views."

### UX-10: Chart Design Rules

- **Max 6 data series per chart** — if more, group into "Other"
- **Always label axes** with units (%, count, ₹)
- **Tooltips on hover** show exact values (Recharts `<Tooltip>` with custom formatter)
- **Legend is clickable** to toggle series visibility
- **No 3D, no pie charts for >5 slices** — use horizontal bar charts for comparison
- **Consistent chart sizing**: min-height 200px, max-height 400px
- **Bar charts for comparison**, line charts for trends over time, heatmap for matrix data
- Color follows UX-3 color language — never random palette

### Shared UI Components to Build

These components enforce the UX system and are used across all modules:

| Component | UX Rules Enforced | Props |
|-----------|-------------------|-------|
| `<MetricCard>` | UX-2 hierarchy, UX-3 colors, UX-6 skeleton | `label, value, trend?, tone: 'brand'\|'blue'\|'amber'\|'rose'\|'slate', loading?` |
| `<ScoreBadge>` | UX-3 auto-color from value | `score: number` → auto-selects tone from thresholds |
| `<CompletionBar>` | UX-3 colors, UX-7 text+color | `percent: number, showLabel?: boolean` |
| `<DataTable>` | UX-1 progressive, UX-7 a11y, UX-8 responsive | Wraps TanStack: adds sorting, filtering, pagination, card-list mobile view |
| `<FilterBar>` | UX-5 visible+clearable filters | `filters: FilterDef[], active: Record, onChange` |
| `<SkeletonCard>` | UX-6 skeleton loader | `variant: 'metric'\|'table-row'\|'chart'` |
| `<EmptyState>` | UX-5 helpful empty | `icon, title, description, actionLabel?, onAction?` |
| `<SlideOver>` | UX-1 progressive disclosure | `open, onClose, title, children` — right-side panel with overlay |
| `<ConfirmDialog>` | UX-5 forgiving | `open, title, description, confirmLabel, onConfirm, onCancel, variant: 'danger'\|'warning'` |
| `<PeriodSelector>` | UX-9 smart default | `periods[], selectedId, onChange` — defaults to current active |
| `<Breadcrumb>` | UX-4 wayfinding | `items: {label, onClick?}[]` — last item is current (no link) |
| `<ChartContainer>` | UX-10 chart rules, UX-7 a11y | `title, children, fallbackData?` — wraps chart + "View as table" toggle |
| `<StatusPill>` | UX-3 colors | `state: string` → maps to color+label (DRAFT→amber, VERIFIED→teal, etc.) |
| `<OrientationBanner>` | UX-9 first-time | `storageKey, message` — shows once, dismissible, remembered in localStorage |

---

## Module 0 — Hierarchy Scope Engine (Foundation)

### 0.1 New utility: `src/lib/org-structure/hierarchy-utils.ts`

Reusable functions that everything else depends on. Uses `OrgUnit.path` for efficient `LIKE` queries with BFS fallback.

```typescript
// Get all descendant unit IDs under a root (using path column)
getDescendantUnitIds(tenantId, rootUnitId, includeRoot?): Promise<string[]>

// Get descendant IDs for multiple roots (union)
getSubtreeUnitIds(tenantId, rootUnitIds[]): Promise<string[]>

// Get ancestor chain from unit to root (for breadcrumb)
getAncestorChain(tenantId, unitId): Promise<{id, name, code, level, category}[]>

// Get sibling units (same parent) for cross-unit comparison
getSiblingUnits(tenantId, unitId): Promise<{id, name, code, category}[]>
```

### 0.2 New utility: `src/lib/org-structure/scope-resolver.ts`

Resolves what units a user can see based on their role assignments.

```typescript
type UserDashboardScope = {
  userId: string;
  tenantId: string;
  isTenantAdmin: boolean;           // TENANT_OWNER or TENANT_ADMIN
  headOfUnits: { unitId, unitName, unitCode, scope: 'NODE'|'DESCENDANTS' }[];
  memberOfUnits: { unitId, unitName, unitCode }[];
  hasApprovalAuthority: boolean;    // any role with approvalAuthority=true
  visibleUnitIds: string[] | 'ALL'; // resolved set of all units user can see
  rootScopeUnits: { unitId, unitName, unitCode, category }[]; // top-level units for dashboard entry
};

resolveUserDashboardScope(tenantId, userId): Promise<UserDashboardScope>
```

**Resolution logic:**
1. Call `getUserAssignments(tenantId, userId)` — returns all role assignments
2. For each assignment where `isUnitHead=true`:
   - If `scope='NODE'` → add that unit only
   - If `scope='DESCENDANTS'` → call `getDescendantUnitIds()` → add all
3. For tenant admin → `visibleUnitIds = 'ALL'`
4. `rootScopeUnits` = the highest-level units the user heads (entry points for drill-down)
5. `hasApprovalAuthority` = any role assignment whose roleDefinition has `approvalAuthority=true`

### 0.3 Scope-filtered query helper

```typescript
// Wraps a Prisma where clause to add unit scope filtering
// Used by ALL dashboard service functions
applyScopeFilter(
  baseWhere: object,
  scope: UserDashboardScope,
  unitIdField: string  // e.g. 'assignedToUnitId' or 'rewardOwnerUnitId'
): object
```

If `scope.visibleUnitIds === 'ALL'`, returns `baseWhere` unchanged. Otherwise adds `{ [unitIdField]: { in: scope.visibleUnitIds } }`.

### Files to create
- `src/lib/org-structure/hierarchy-utils.ts`
- `src/lib/org-structure/scope-resolver.ts`

### Files to modify
- `src/lib/kra-kpi/dashboard-service.ts` — add `scopeUnitIds?: string[] | 'ALL'` parameter to ALL existing functions (`getOverviewStats`, `getOrgHierarchyStats`, `getAttentionItems`, `getStageBottleneckAnalysis`, `getKpiCrossComparison`, `getPersonDetail`)

---

## Module 1 — Dashboard Views by Role

The dashboard is a **single page** (`/dashboard`) with a tab bar. Tabs are shown/hidden based on `UserDashboardScope`. Every user always sees "My KPIs". Additional tabs appear based on role assignments.

### 1.1 Tab visibility rules (no new role concepts)

| Tab | Shown When | Data Scope |
|-----|-----------|------------|
| **My KPIs** | Always (has any allocation) | Own allocations only |
| **My Reviews** | `headOfUnits.length > 0` (is unit head of anything) | Achievements routed to their unit(s) for review |
| **My Unit** | `headOfUnits.length > 0` | Direct members of their unit(s) |
| **Organization** | `headOfUnits.length > 0` with children, OR tenant admin | Hierarchy subtree under their root scope units |
| **Rewards** | `hasApprovalAuthority` OR tenant admin | Reward pipeline scoped to visible units |
| **Notifications** | Always | Own notifications |

### 1.2 New page: `src/app/kpi-dashboard/page.tsx` (Finding 1 fix: `/kpi-dashboard` not `/dashboard`)

Server component that:
1. Gets session user
2. Calls `resolveUserDashboardScope()`
3. Passes scope to `<DashboardHub scope={scope} />`

### 1.3 Component: `src/components/dashboard/dashboard-hub.tsx`

Client component. State:
- `activeTab`: derived from URL param `?tab=my-kpis|reviews|unit|org|rewards|notifications`
- `selectedPeriodId`: shared across all tabs via `<PeriodSelector>`
- Renders only the tabs the user's scope allows

---

## Module 2 — "My KPIs" Tab (Contributor View)

**Who sees this**: Every user with allocations.

### 2.1 Enhance existing `my-dashboard.tsx`

Add a **"My Rewards"** card below the existing dashboard content:

```
┌─────────────────────────────────┐
│ My Rewards This Period          │
│ ┌───────┐ ┌───────┐ ┌───────┐  │
│ │ ₹12K  │ │ ₹5K   │ │ ₹45K  │  │
│ │ Draft │ │Pending│ │Released│  │
│ └───────┘ └───────┘ └───────┘  │
│ [View All Rewards →]            │
└─────────────────────────────────┘
```

### 2.2 New API
- `GET /api/tenant/kra-kpi/rewards/my?periodId=X` → calls existing `listContributorRewards` filtered to `contributorUserId = currentUser`

### Files to create
- `src/components/dashboard/contributor/my-rewards-card.tsx`

### Files to modify
- `src/components/my-kpis/my-dashboard.tsx` — add MyRewardsCard at bottom

---

## Module 3 — "My Reviews" Tab (Recommender / Approver View)

**Who sees this**: Any user who is `isUnitHead=true` for any unit.

This tab shows achievements awaiting the user's action — whether recommendation (keyUnit head) or final verification (finalUnit/startingUnit head). Uses existing `getMyReviewQueue()`.

### 3.1 Layout

```
┌────────────────────────────────────────────┐
│ Pending Reviews                            │
│ ┌──────┐ ┌──────┐ ┌──────┐                │
│ │  12  │ │   5  │ │   3  │                │
│ │ Await│ │Recomm│ │ Over │                │
│ │Review│ │ended │ │ 7day │                │
│ └──────┘ └──────┘ └──────┘                │
│                                            │
│ ┌──────────────────────────────────────┐   │
│ │ Achievement Table                    │   │
│ │ Contributor | KPI | State | Submitted│   │
│ │ Prof X     | Pub | SUBM  | 3 days   │   │
│ │ Prof Y     | Pat | RECOM | 1 day    │   │
│ │ [Recommend] [Verify] [Reject]       │   │
│ └──────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

### 3.2 API routes
- `GET /api/tenant/kra-kpi/dashboard/review-queue?periodId=X` — enhanced version of existing `getMyReviewQueue()` with counts by state and staleness

### Files to create
- `src/components/dashboard/reviewer/reviewer-panel.tsx`
- `src/components/dashboard/reviewer/review-queue-table.tsx`

---

## Module 4 — "My Unit" Tab (Unit Head's Team View)

**Who sees this**: Any user who is `isUnitHead=true`. Shows members of the unit(s) they head.

### 4.1 Layout

```
┌──────────────────────────────────────────────┐
│ Unit: Computer Science Department            │
│ (if heads multiple units: unit selector)     │
│                                              │
│ Overview: 15 members | 45 allocations        │
│ Completion: ████████░░ 72%  Avg Score: 68.4  │
│                                              │
│ ┌────────────────────────────────────────┐   │
│ │ Members                                │   │
│ │ Name       | Alloc | Done | Score | ⚠  │   │
│ │ Prof X     |   5   |  3   | 78.2  |   │   │
│ │ Prof Y     |   4   |  1   | 45.0  | ⚠ │   │
│ │ Dr Z       |   6   |  6   | 92.1  |   │   │
│ │ [Click row → person detail slide-over] │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ KRA Breakdown          Stage Bottleneck      │
│ [Bar Chart]            [Funnel Chart]        │
└──────────────────────────────────────────────┘
```

### 4.2 Person Detail Slide-Over

When clicking a member row, shows:
- All their allocations with target vs actual
- Stage progress per KPI
- Achievement states
- Score breakdown
- Reward summary for that person

Uses existing `getPersonDetail()` + new reward query.

### 4.3 API routes
- `GET /api/tenant/kra-kpi/dashboard/unit-members?periodId=X&unitId=Y` — new endpoint
- Reuses existing `/person?periodId=X&userId=Y`

### Files to create
- `src/components/dashboard/unit/unit-panel.tsx`
- `src/components/dashboard/unit/unit-members-table.tsx`
- `src/components/dashboard/unit/person-detail-slideout.tsx`
- `src/components/dashboard/unit/kra-breakdown-chart.tsx`

---

## Module 5 — "Organization" Tab (Hierarchy Drill-Down)

**Who sees this**: Unit heads with child units under them, OR tenant admin.
**This is the most critical module.**

### 5.1 Hierarchy Browser

The core interaction: a **breadcrumb + drill-down table** that lets the user navigate their org subtree.

```
Breadcrumb: [University] > [School of Engineering] > [CS Department]

┌──────────────────────────────────────────────────────┐
│ CS Department                         Period: 2025-26│
│                                                      │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│ │  45  │ │  32  │ │ 71%  │ │ 68.4 │ │   3  │       │
│ │Alloc │ │Verif │ │Compl │ │ Avg  │ │Overdue│      │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘       │
│                                                      │
│ [Children] [Members] [KRA Detail] [Compare Periods]  │
│                                                      │
│ ┌────────────────────────────────────────────────┐   │
│ │ Sub-Units                            (default) │   │
│ │ Unit         | Alloc | Done | %    | Avg | ▼  │   │
│ │ AI Lab       |  12   |   9  | 75%  | 72  | → │   │
│ │ Data Science |   8   |   4  | 50%  | 61  | → │   │
│ │ Networks     |  10   |   8  | 80%  | 74  | → │   │
│ │ [Click row → drill into that unit]             │   │
│ └────────────────────────────────────────────────┘   │
│                                                      │
│ KRA Performance (this unit + descendants)            │
│ ┌────────────────────────────────────────────────┐   │
│ │ [Stacked Bar Chart: KRA-wise completion %]     │   │
│ └────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### 5.2 View Modes (tabs within Organization)

**Children View** (default): Table of direct child units with roll-up metrics. Click a row to drill down.

**Members View**: Table of members assigned to this specific unit. Click a row to open person detail.

**KRA Detail View**: Expandable table showing each KRA → KPI with completion %, avg score, stage funnel.

**Compare Periods View**: Select 2–5 periods, see same KPI metrics side by side.

### 5.3 Drill-Down Navigation

- URL state: `/dashboard?tab=org&periodId=X&unitId=Y&view=children`
- Breadcrumb built from `getAncestorChain(unitId)`, filtered to only show units within user's scope
- Drill into child: click row → update `unitId` param → fetch new data
- Drill up: click breadcrumb segment → jump to that level
- If unit has no children → auto-switch to Members view

### 5.4 Cross-Unit Comparison

When viewing children of a unit, a "Compare" button shows:

```
┌──────────────────────────────────────────────────────┐
│ Cross-Unit Comparison: School of Engineering         │
│                                                      │
│ Heatmap: Units × KRAs (color = avg score)            │
│ ┌────────────────────────────────────────────────┐   │
│ │          | Research | Teaching | Service       │   │
│ │ CS Dept  | ██ 78   | ██ 65   | ██ 82         │   │
│ │ EE Dept  | ██ 72   | ██ 71   | ██ 68         │   │
│ │ ME Dept  | ██ 65   | ██ 80   | ██ 75         │   │
│ └────────────────────────────────────────────────┘   │
│                                                      │
│ Bar Chart: Overall completion % per unit             │
│ ┌────────────────────────────────────────────────┐   │
│ │ CS ████████░░ 75%                              │   │
│ │ EE ███████░░░ 70%                              │   │
│ │ ME ██████░░░░ 65%                              │   │
│ └────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### 5.5 Period-over-Period Comparison

```
┌──────────────────────────────────────────────────────┐
│ Period Comparison: Research Publications              │
│ Periods: [2023-24] [2024-25] [2025-26]              │
│                                                      │
│ Grouped Bar Chart                                    │
│ ┌────────────────────────────────────────────────┐   │
│ │  Target  ████  ████  ████                      │   │
│ │  Actual  ███   ████  ██                        │   │
│ │         23-24  24-25  25-26                    │   │
│ └────────────────────────────────────────────────┘   │
│                                                      │
│ Metric Table                                         │
│ Period  | Target | Achieved | Compl% | Avg Score     │
│ 2023-24 |   80   |    72    |  90%   |  74.2         │
│ 2024-25 |  100   |    87    |  87%   |  72.3         │
│ 2025-26 |  120   |    65    |  54%   |  68.1         │
└──────────────────────────────────────────────────────┘
```

Matches KPIs across periods by **title** (since IDs differ when periods are copied via `copyKrasFromPeriod`).

### 5.6 New API routes

| Route | Method | Params | Returns |
|-------|--------|--------|---------|
| `dashboard/scope` | GET | — | `UserDashboardScope` |
| `dashboard/drill-down` | GET | `periodId, unitId` | `DrillDownNode` (unit metrics + KRA breakdown) |
| `dashboard/unit-members` | GET | `periodId, unitId` | `UnitMemberSummary[]` |
| `dashboard/cross-unit` | GET | `periodId, parentUnitId` | `CrossUnitComparison` (siblings + KRA heatmap data) |
| `dashboard/period-comparison` | GET | `kpiTitle, periodIds` | `PeriodComparisonResult` |

### 5.7 New service functions in `dashboard-service.ts`

```typescript
// Aggregated metrics for a single unit (including all descendants)
getDrillDownNode(tenantId, periodId, unitId, scopeUnitIds?): Promise<DrillDownNode>

type DrillDownNode = {
  unitId: string; unitName: string; unitCode: string;
  category: string; level: number;
  totalAllocations: number; completedAllocations: number;
  completionPercent: number; averageScore: number;
  memberCount: number; childUnitCount: number;
  kraPerformance: { kraId: string; kraTitle: string; avgScore: number; completionPercent: number }[];
};

// Sibling comparison with KRA-level breakdown
getCrossUnitComparison(tenantId, periodId, parentUnitId): Promise<CrossUnitComparison>

type CrossUnitComparison = {
  units: {
    unitId: string; unitName: string; category: string;
    totalAllocations: number; completedAllocations: number;
    completionPercent: number; averageScore: number;
    kraBreakdown: { kraId: string; kraTitle: string; avgScore: number }[];
  }[];
};

// Same KPI across periods
getKpiPeriodComparison(tenantId, kpiTitle, periodIds[]): Promise<PeriodComparisonResult>

type PeriodComparisonResult = {
  kpiTitle: string;
  periods: {
    periodId: string; periodName: string;
    targetTotal: number; achievedTotal: number;
    completionPercent: number; averageScore: number;
    verifiedCount: number; totalAllocations: number;
  }[];
};

// Members of a specific unit with their performance
getUnitMembersSummary(tenantId, periodId, unitId): Promise<UnitMemberSummary[]>

type UnitMemberSummary = {
  userId: string; userName: string;
  totalAllocations: number; completedAllocations: number;
  overallScore: number; overdueCount: number;
};
```

### Files to create
- `src/components/dashboard/org/org-panel.tsx`
- `src/components/dashboard/org/hierarchy-browser.tsx`
- `src/components/dashboard/org/hierarchy-breadcrumb.tsx`
- `src/components/dashboard/org/unit-overview-cards.tsx`
- `src/components/dashboard/org/unit-children-table.tsx`
- `src/components/dashboard/org/unit-members-table.tsx`
- `src/components/dashboard/org/person-detail-slideout.tsx` (shared with Module 4)
- `src/components/dashboard/org/kra-performance-chart.tsx`
- `src/components/dashboard/org/cross-unit-heatmap.tsx`
- `src/components/dashboard/org/period-comparison-chart.tsx`
- `src/components/dashboard/org/stage-funnel-chart.tsx`
- `src/components/dashboard/org/attention-alerts.tsx`
- `src/app/api/tenant/kra-kpi/dashboard/scope/route.ts`
- `src/app/api/tenant/kra-kpi/dashboard/drill-down/route.ts`
- `src/app/api/tenant/kra-kpi/dashboard/unit-members/route.ts`
- `src/app/api/tenant/kra-kpi/dashboard/cross-unit/route.ts`
- `src/app/api/tenant/kra-kpi/dashboard/period-comparison/route.ts`

---

## Module 6 — "Rewards" Tab (Finance / Approval Authority View)

**Who sees this**: Users whose role has `approvalAuthority=true`, OR tenant admin.

### 6.1 Layout

```
┌──────────────────────────────────────────────────────┐
│ Reward Pipeline                       Period: 2025-26│
│                                                      │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                │
│ │₹120K │ │ ₹45K │ │₹380K │ │ ₹15K │                │
│ │Draft │ │Pend. │ │Rele. │ │Revok.│                │
│ └──────┘ └──────┘ └──────┘ └──────┘                │
│                                                      │
│ [Pipeline] [Reconciliation] [Audit Log]              │
│                                                      │
│ Pipeline View:                                       │
│ Filters: [State ▼] [Benefit Type ▼] [Unit ▼]       │
│ ┌────────────────────────────────────────────────┐   │
│ │ ☐ Contributor | KPI      | Amount | State | Act│   │
│ │ ☐ Prof X     | Pub Q1   | ₹5000  | PEND  |    │   │
│ │ ☐ Prof Y     | Patent   | ₹10000 | DRAFT |    │   │
│ │ ☑ Dr Z       | Grant    | ₹8000  | PEND  |    │   │
│ └────────────────────────────────────────────────┘   │
│ Selected: 1 | Total: ₹8,000                         │
│ [Approve →] [Release with Ref# →] [Revoke →]       │
│                                                      │
│ Reconciliation View:                                 │
│ Group By: [Benefit Type ▼]                          │
│ ┌────────────────────────────────────────────────┐   │
│ │ Type     | Draft  | Pending| Released| Total   │   │
│ │ Cash     | ₹50K   | ₹20K   | ₹200K  | ₹270K  │   │
│ │ Points   | 1200   | 500    | 3500   | 5200   │   │
│ │ GRAND    | —      | —      | —      | ₹275.2K│   │
│ └────────────────────────────────────────────────┘   │
│ [Export CSV ↓]                                       │
└──────────────────────────────────────────────────────┘
```

### 6.2 Scope filtering

Reward queries are filtered by `rewardOwnerUnitId IN (visibleUnitIds)`. A department head with `approvalAuthority` only sees rewards for their department. Tenant admin sees all.

### 6.3 API routes

Uses existing reward routes from R4:
- `GET /api/tenant/kra-kpi/rewards` — already built in `reward-ops-service.ts` with `listContributorRewards`
- `POST /api/tenant/kra-kpi/rewards/transition` — already built with `transitionContributorRewards`

New routes:
- `GET /api/tenant/kra-kpi/rewards/reconciliation?periodId=X&groupBy=benefitType|unit` — aggregated reconciliation view
- `GET /api/tenant/kra-kpi/rewards/export?periodId=X&format=csv` — CSV download

### 6.4 New service functions in `reward-ops-service.ts`

```typescript
getRewardReconciliation(tenantId, periodId, groupBy, scopeUnitIds?): Promise<ReconciliationResult>

type ReconciliationResult = {
  rows: {
    groupKey: string; groupLabel: string;
    draftAmount: number; pendingAmount: number;
    releasedAmount: number; revokedAmount: number;
    totalAmount: number; rewardCount: number;
  }[];
  grandTotal: { draft: number; pending: number; released: number; revoked: number; total: number };
};

exportRewardsCSV(tenantId, periodId, filters?, scopeUnitIds?): Promise<string>
```

### Files to create
- `src/components/dashboard/rewards/reward-panel.tsx`
- `src/components/dashboard/rewards/reward-pipeline-table.tsx`
- `src/components/dashboard/rewards/reward-bulk-actions.tsx`
- `src/components/dashboard/rewards/reward-reconciliation.tsx`
- `src/components/dashboard/rewards/reward-export-button.tsx`
- `src/app/api/tenant/kra-kpi/rewards/reconciliation/route.ts`
- `src/app/api/tenant/kra-kpi/rewards/export/route.ts`

### Files to modify
- `src/lib/kra-kpi/reward-ops-service.ts` — add `scopeUnitIds` to `listContributorRewards`, add `getRewardReconciliation`, `exportRewardsCSV`

---

## Module 7 — Notification Center

### 7.1 Header Bell Icon (already exists)

`notification-bell.tsx` exists with unread count + dropdown. Enhance with "View All →" link.

### 7.2 Full Page (new)

Either as a tab in dashboard or standalone `/notifications` page:
- Paginated list (20 per page)
- Filter by type (checkbox group), read/unread toggle, date range
- Each item shows: icon, title, message, timestamp, entity link
- Bulk "mark as read"

### Files to create
- `src/components/dashboard/notifications/notification-panel.tsx`
- `src/components/dashboard/notifications/notification-filters.tsx`

### Files to modify
- `src/components/notifications/notification-bell.tsx` — add "View All" link
- `src/app/api/tenant/notifications/route.ts` — add `typeFilter` query param

---

## Module 8 — Shared UX Component Library

All shared components follow the UX Design System (Section above). These are the building blocks every module uses.

### Files to create (in `src/components/dashboard/shared/`)

| File | Component | UX Rules | Notes |
|------|-----------|----------|-------|
| `metric-card.tsx` | `<MetricCard>` | UX-2, UX-3, UX-6 | Large number + label + optional trend arrow. Auto-skeleton when `loading=true`. |
| `score-badge.tsx` | `<ScoreBadge>` | UX-3, UX-7 | Rounded pill: auto-color from score thresholds. Shows number + color (never color-only). |
| `completion-bar.tsx` | `<CompletionBar>` | UX-3, UX-7 | Tailwind progress bar with % text overlay. Color auto-selected by range. |
| `data-table.tsx` | `<DataTable>` | UX-1, UX-7, UX-8 | Wraps TanStack React Table. Adds: column sorting (click header), filter row, pagination (10/25/50), skeleton rows while loading, card-list view on mobile (<768px). |
| `filter-bar.tsx` | `<FilterBar>` | UX-5 | Active filters as removable pills. "Clear all" link. Filter definitions: `{key, label, type: 'select'\|'multi-select'\|'date-range', options?}`. |
| `skeleton-card.tsx` | `<SkeletonCard>` | UX-6 | Animated gray placeholder. Variants: `metric` (rectangle), `table-row` (bar lines), `chart` (area shape). |
| `empty-state.tsx` | `<EmptyState>` | UX-5 | Centered icon + title + helpful description + optional action button. Never just "No data". |
| `slide-over.tsx` | `<SlideOver>` | UX-1, UX-7 | Right-side overlay panel. Focus trap, Escape to close, backdrop click to close. Width: 480px desktop, full on mobile. |
| `confirm-dialog.tsx` | `<ConfirmDialog>` | UX-5 | Centered modal. `variant: 'danger'` shows red confirm button. Shows summary (e.g., "Release 5 rewards totaling ₹42,000?"). |
| `period-selector.tsx` | `<PeriodSelector>` | UX-9 | Dropdown. Defaults to current active period. Shows period name + date range. Sticky positioning. |
| `breadcrumb.tsx` | `<Breadcrumb>` | UX-4 | `items: {label, onClick?}[]`. Last item is current (bold, no link). Separator: `>`. Truncates middle items on mobile. |
| `chart-container.tsx` | `<ChartContainer>` | UX-10, UX-7 | Wrapper: title, Recharts child, "View as table" toggle for accessibility. Min-height 200px. |
| `status-pill.tsx` | `<StatusPill>` | UX-3 | Maps state strings to color+label. Mappings: `DRAFT→amber, SUBMITTED→blue, RECOMMENDED→blue, VERIFIED→teal, REJECTED→rose, PENDING→amber, RELEASED→teal, REVOKED→rose`. |
| `orientation-banner.tsx` | `<OrientationBanner>` | UX-9 | Dismissible info banner. Stores dismissed state in localStorage by `storageKey`. Shows only once per user. |
| `export-button.tsx` | `<ExportButton>` | — | Download trigger. Shows spinner during export. Accepts `href` or `onClick` handler. |

---

## Implementation Phases

### Phase 0: Pre-Requisites (P.1 + P.2 + P.3)
1. Activate `scope` in `getUserAssignments()` return type and `getMyKpiContext()`
2. Activate `approvalAuthority` in `getUserAssignments()` return type
3. Add `approvalAuthority` check to `transitionContributorRewards()`
4. Verify `OrgUnit.path` is populated; add backfill if needed

### Phase 1: Foundation (Module 0 + 8)
5. `hierarchy-utils.ts` — descendant/ancestor/sibling functions
6. `scope-resolver.ts` — user dashboard scope resolution
7. Add `scopeUnitIds` parameter to existing dashboard-service.ts functions
8. Build ALL shared UI components (data-table, slide-over, confirm-dialog, filter-bar, etc.)
9. Dashboard page + hub + tab bar with persona detection

### Phase 2: Contributor + Reviewer (Module 2 + 3)
10. My Rewards card in contributor view
11. Review queue panel with sortable table and action buttons

### Phase 3: Unit Head View (Module 4)
12. Unit panel with members DataTable (sortable, filterable)
13. Person detail SlideOver
14. KRA breakdown ChartContainer

### Phase 4: Organization Drill-Down (Module 5) — largest phase
15. Hierarchy browser with Breadcrumb navigation
16. Unit children DataTable with drill-down (click row → navigate)
17. Unit members DataTable (leaf level)
18. Cross-unit heatmap in ChartContainer
19. Period comparison chart in ChartContainer
20. Stage funnel chart in ChartContainer
21. Attention alerts (MetricCard with rose/amber tones)

### Phase 5: Rewards (Module 6)
22. Reward pipeline DataTable with FilterBar + bulk selection
23. Bulk actions with ConfirmDialog (approve/release/revoke)
24. Reconciliation view with grouping
25. CSV ExportButton

### Phase 6: Notifications (Module 7)
26. Full page notification center with FilterBar
27. Bell icon "View All" link

---

## Key Existing Functions to Reuse

| Function | File | Use In |
|----------|------|--------|
| `getUserAssignments()` | `roles-service.ts` | Scope resolver |
| `getMyKpiContext()` | `my-kpi-service.ts` | Scope resolver |
| `getApprovalChain()` | `roles-service.ts` | Breadcrumb generation |
| `getUnitMembers()` | `roles-service.ts` | Unit panel, member lists |
| `getMyReviewQueue()` | `my-kpi-service.ts` | Review tab |
| `getOverviewStats()` | `dashboard-service.ts` | All overview cards |
| `getOrgHierarchyStats()` | `dashboard-service.ts` | Children table |
| `getKpiCrossComparison()` | `dashboard-service.ts` | KRA detail view |
| `getAttentionItems()` | `dashboard-service.ts` | Attention alerts |
| `getStageBottleneckAnalysis()` | `dashboard-service.ts` | Stage funnel |
| `getPersonDetail()` | `dashboard-service.ts` | Person slide-out |
| `listContributorRewards()` | `reward-ops-service.ts` | Reward pipeline |
| `transitionContributorRewards()` | `reward-ops-service.ts` | Bulk actions |
| `getNotifications()` | `notification-service.ts` | Notification center |
| `computeWeightedOverallScore()` | `scoring-service.ts` | Score displays |

---

## Verification Plan

### Functional Tests
1. **Scope resolver**: Unit test — create org tree, assign roles with NODE/DESCENDANTS scope, verify `visibleUnitIds` is correct
2. **Hierarchy utils**: Unit test — verify `getDescendantUnitIds` returns correct set, `getAncestorChain` returns correct path
3. **Dashboard API**: Integration test — call each endpoint with different user scopes, verify data is filtered correctly
4. **Drill-down navigation**: Manual test — log in as dept head, verify can only see own subtree; log in as tenant admin, verify sees everything
5. **Period comparison**: Manual test — pick same KPI across 3 periods, verify metrics match
6. **Reward pipeline**: Manual test — filter by unit, verify only scoped rewards appear; test bulk transition
7. **Cross-unit heatmap**: Manual test — verify sibling units shown with correct KRA scores
8. **approvalAuthority gate**: Manual test — user WITHOUT approvalAuthority cannot see Rewards tab or transition rewards

### UX Verification Checklist
9. **Progressive disclosure**: Verify no view shows >5 summary metrics on initial load; details require interaction
10. **Color consistency**: Verify all score badges, progress bars, status pills, and chart colors follow the 5-color system (teal/blue/amber/rose/slate)
11. **Empty states**: Navigate to every tab with no data — verify helpful messages with suggested actions (not blank or "No data")
12. **Skeleton loaders**: Throttle network in browser DevTools — verify skeleton placeholders appear during loading (not spinners or blank)
13. **Mobile responsiveness**: Test at 375px width — verify tables become card lists, charts simplify, breadcrumb truncates, slide-over goes full-width
14. **Keyboard navigation**: Tab through review queue table, press Enter to open detail, Escape to close slide-over — all must work without mouse
15. **Filter visibility**: Apply 3 filters on any DataTable — verify they appear as removable pills, "Clear all" link works
16. **Breadcrumb accuracy**: Drill 4 levels deep in Organization tab — verify breadcrumb matches exact path, clicking any segment navigates correctly
17. **Smart defaults**: Fresh user login — verify period selector defaults to active period, Organization tab starts at user's scope root, review queue sorted by staleness
18. **Chart accessibility**: Verify every chart has a "View as table" toggle that shows the same data in tabular form
