# KRA/KPI Performance Framework — Master Roadmap
# ═══════════════════════════════════════════════════════════════════════════════

## R4 — Contributor & Reward Framework — ✅ COMPLETE

All R4 modules implemented by Codex:

```
R4.1a  Benefit Types & Contributor Roles              ✅ DONE
R4.1b  External Contributors & Templates              ✅ DONE
R4.1c  Team Achievements & Duplicate Detection        ✅ DONE
R4.2   KPI Builder, Reward Tiers & Calculation        ✅ DONE (Codex — relational approach)
R4.3   Remarks, Corrections, Notifications, Rewards   ✅ DONE (Codex — unified R4.3)
```

**Key architectural decisions by Codex (deviated from original plan):**
- Relational reward config (KpiRewardTier → KpiRewardRule, KpiRewardComponent → KpiRewardDistribution) instead of JSON blobs
- State machine: DRAFT → PENDING → RELEASED → REVOKED (not CALCULATED → APPROVED → DISBURSED → CANCELLED)
- `correctVerifiedAchievement` replaces credit-override-at-verification
- Revoke-and-replace semantics for released rewards (immutable once released)
- ContributorRewardEvent append-only audit trail
- Idempotent notifications via eventKey unique constraint
- Dispute workflow intentionally deferred

---

## R5 — Unified Role-Based Dashboard & Analytics — 🔲 READY

### Sub-Module Breakdown

```
R5.0  Role Fixes + Hierarchy Scope Engine     🔲  Backend (Codex)     Blocks all R5
R5.1  Shared UI Components + Dashboard Shell  🔲  Frontend (Opus)     Depends on R5.0
R5.2  "My KPIs" + "My Reviews" Tabs           🔲  Frontend (Opus)     Depends on R5.1
R5.3  "My Unit" Tab (Unit Head View)           🔲  Frontend (Opus)     Depends on R5.1
R5.4  "Organization" Tab (Hierarchy Drill-Down)🔲  Full-stack (Opus)   Depends on R5.0, R5.1
R5.5  "Rewards" Tab (Pipeline + Reconciliation)🔲  Full-stack (Both)   Depends on R5.0, R5.1
R5.6  Notification Center                      🔲  Frontend (Opus)     Depends on R5.1
```

### Dependency Graph

```
R5.0 (backend foundation)
  ├──→ R5.1 (shared UI + shell)
  │      ├──→ R5.2 (contributor + reviewer)
  │      ├──→ R5.3 (unit head)
  │      ├──→ R5.4 (org drill-down)    ← also needs R5.0
  │      ├──→ R5.5 (rewards)           ← also needs R5.0
  │      └──→ R5.6 (notifications)
  │
  │  R5.2, R5.3, R5.4, R5.5, R5.6 can run IN PARALLEL after R5.1
```

### Plan Files

| Module | Plan File | Effort |
|--------|-----------|--------|
| R5.0 | `R5.0-role-fixes-hierarchy-engine.md` | Small (1-2 days) |
| R5.1 | `R5.1-shared-ui-components-dashboard-shell.md` | Medium (2-3 days) |
| R5.2 | `R5.2-contributor-reviewer-tabs.md` | Small (1 day) |
| R5.3 | `R5.3-unit-head-tab.md` | Small-Medium (1-2 days) |
| R5.4 | `R5.4-organization-drill-down.md` | Large (3-4 days) |
| R5.5 | `R5.5-rewards-tab.md` | Medium (2 days) |
| R5.6 | `R5.6-notifications-center.md` | Small (1 day) |

### Key Design Decisions

1. **No new role concepts** — dashboard tabs driven by existing `isUnitHead`, `approvalAuthority`, `scope (NODE|DESCENDANTS)`
2. **Activate unused schema fields** — `scope` and `approvalAuthority` already exist but were never enforced
3. **10 UX principles** — progressive disclosure, 5-color system, skeleton loaders, keyboard navigation, responsive, smart defaults
4. **15 shared components** — DataTable, SlideOver, ConfirmDialog, FilterBar, MetricCard, ScoreBadge, etc.
5. **Hierarchy-scoped queries** — every dashboard query filtered by `visibleUnitIds` from scope resolver

---

## R6 — Accreditation & Ranking Integration — 🔲 NOT STARTED

(Plans exist at R3.1–R3.4 but implementation not yet scheduled)

---

## Overall Progress

| Phase | Status | Scope |
|-------|--------|-------|
| R1 | ✅ Complete | Foundation: periods, KRAs, KPIs, targets, measurements, scoring |
| R2 | ✅ Complete | Stages, submission, approval, admin dashboard |
| R3 | 📋 Planned | Accreditation framework, assessment workspace, KPI integration |
| R4 | ✅ Complete | Contributors, rewards, tiers, calculation, notifications, audit |
| R5 | 📋 Planned | Unified dashboards, analytics, hierarchy drill-down |
| R6 | 📋 Planned | Accreditation & ranking integration |
