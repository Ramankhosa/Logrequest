# R4 — KRA/KPI Contributor & Reward Framework — Master Roadmap
# ═══════════════════════════════════════════════════════════════════════════════

## Implementation Order & Status

```
R4.1a  Benefit Types & Contributor Roles          ✅ DONE (implemented + tested)
R4.1b  External Contributors & Templates           ✅ DONE (implemented + tested)
R4.1c  Team Achievements & Duplicate Detection      ✅ DONE (implemented + tested)
R4.3a  Remarks, Verifier Override & Dispute         🔲 READY (plan written)
R4.3b  Comprehensive Notifications                  🔲 READY (plan written)
R4.2   KPI Templates, Reward Tiers & Calculation    🔲 READY (plan written — unified, replaces old R4.2a + R4.2b)
```

## Dependency Graph

```
R4.1a ─────────┐
               ├──→ R4.1c ──→ R4.3a (remarks, override, dispute)
R4.1b ─────────┘              R4.3b (notifications — can run parallel with R4.3a)
               │
               └──→ R4.2 (templates + reward tiers + calculation — unified)
                      ↑ benefits from R4.3a being done first (credit overrides feed recalc)
```

## Recommended Build Sequence for Codex

### Sprint 1: R4.3a (Small — 1-2 days)
- **What:** Add `remarks` field, verifier credit override, contributor dispute
- **Why first:** Smallest change, no new tables, extends existing flows
- **Schema:** 1 migration (add columns to Achievement + AchievementContributor)
- **Files touched:** achievement-service.ts, achievement-contributor-service.ts, shared.ts
- **Tests:** 30 scenarios
- **Plan:** `.claude/plans/R4.3a-remarks-verifier-override-dispute.md`

### Sprint 2: R4.3b (Small — 1 day)
- **What:** Wire all missing notification events across KRA-KPI
- **Why:** No schema changes, just add `createNotification` calls
- **Files touched:** achievement-service.ts, achievement-contributor-service.ts, target-service.ts
- **Tests:** 20 scenarios
- **Plan:** `.claude/plans/R4.3b-kra-kpi-notifications-comprehensive.md`

### Sprint 3: R4.2 (Medium — ~5 days)
- **What:** KPI templates, embedded reward tiers, auto-calculation, disbursement tracking, copy fixes
- **Why:** The complete reward loop — from KPI config to "here's your ₹50K"
- **Architecture:** Reward tiers embedded as JSON on KpiContributorConfig (NOT standalone tables)
- **Schema:** 2 new models (KpiTemplate, ContributorReward) + 3 new columns
- **New files:** kpi-template-service.ts, reward-tier-resolver.ts, reward-calculation-engine.ts, reward-management-service.ts
- **Bug fixes:** copyKrasFromPeriod missing ApplicableRoles + StageDefinitions copy
- **New features:** copyKpi (within period), applyTemplateToKpi, previewRewards
- **Tests:** 65 scenarios
- **Plan:** `.claude/plans/R4.2-unified-reward-tiers-templates-calculation.md`

---

## Obsoleted Plans

| Old Plan | Status | Replaced By |
|----------|--------|-------------|
| R4.2a — Reward Policies & Categories | ❌ OBSOLETE | R4.2 (unified) |
| R4.2b — Calculation Engine & Disbursement | ❌ OBSOLETE | R4.2 (unified) |

**Reason:** 5 standalone reward policy tables were over-engineered. Real university policies
define fixed per-role amounts (e.g., "First Author: ₹50K"), not "split pool by credit%".
Embedding reward tiers as JSON on KpiContributorConfig eliminates 5 tables, removes the
need for a separate policy management UI, and keeps everything on one KPI configuration page.

---

## Total Scope Summary

| Module | New Tables | New Columns | New Services | API Routes | Tests | Effort |
|--------|-----------|-------------|-------------|------------|-------|--------|
| R4.3a  | 0         | ~12         | 0 (extend)  | 2          | 30    | Small  |
| R4.3b  | 0         | 0           | 0 (wire)    | 0          | 20    | Small  |
| R4.2   | 2         | 3           | 4           | ~16        | 65    | Medium |
| **Total** | **2**  | **~15**     | **4**       | **~18**    | **115** |      |

**Savings vs old plan:** 4 fewer tables, 1 fewer service, ~12 fewer routes, 32 fewer tests, ~2 fewer days.

---

## What the System Can Do After Each Sprint

| After Sprint | Capability |
|---|---|
| **R4.3a** | Applicant writes remarks, verifier adjusts credits, contributors dispute |
| **R4.3b** | Everyone gets notified of every relevant action (submit, approve, reject, add/remove contributor, OBO, disputes) |
| **R4.2** | Admin configures KPIs from templates (with reward tiers), system auto-calculates rewards on verification, tracks approval + disbursement, users preview rewards before submission, KPIs copyable across periods |

After all 3 sprints: **Complete KRA/KPI system with performance tracking, team credit distribution, reward calculation, disbursement tracking, and reusable KPI templates.**
