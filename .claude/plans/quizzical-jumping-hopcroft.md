# KRA/KPI Framework — Implementation Plan (3 Releases)

## Context

The application has modules for org hierarchy (OrgUnit tree), roles (OrgRoleDefinition/Assignment), and user onboarding (bulk import). The next module is a **universal KRA/KPI target-tracking framework** built in 3 incremental releases.

The existing `Kra` (line 591) and `Kpi` (line 612) models in `prisma/schema.prisma` will be **replaced**.

### Key Design Decisions (confirmed by user)
1. **Weightage**: Org total = 100. KRA weightages sum to 100. KPI weightages within a KRA sum to that KRA's weightage. Integer only.
2. **No deletion**: KRAs/KPIs with active allocations cannot be deleted. Must archive.
3. **No negotiation**: Only final decided values are entered. TargetAllocation = ACTIVE/LOCKED.
4. **Verification = reverse of allocation route**: Achievement goes back UP the same path. Verifier can be overridden per allocation.
5. **Evidence = file uploads**: Multiple PDF/Word/image files per achievement.
6. **Fixed stages**: KPI stages defined at KpiDefinition level, uniform for all allocations.
7. **Period types**: Calendar Year, Financial Year, Specific Range with DAILY/WEEKLY/MONTHLY/QUARTERLY/HALF_YEARLY/ANNUAL review cycles.
8. **Cross-functional**: A single KPI can have multiple Target departments.
9. **Accreditation**: Superadmin defines global bodies/criteria + tenants add custom.
10. **Rewards included, disbursement deferred**: Reward definitions + auto-calculation in scope. Payment processing deferred.
11. **Scoring direction**: ASCENDING (higher=better) and DESCENDING (lower=better).
12. **Commission rewards**: PERCENTAGE_OF_ACHIEVEMENT for "X% of achieved value" rewards.
13. **Per-capita display**: `isPerCapita` flag for "papers per teacher" type metrics.
14. **Type-safe configs**: measurementConfig/scoringConfig validated by Zod discriminated unions.

---

# ═══════════════════════════════════════════════════════════════════════════════
# RELEASE 1: Core Framework (5 models, ~3-4 days)
# Working product: create KRAs, define KPIs, set targets, record achievements, compute scores
# ═══════════════════════════════════════════════════════════════════════════════

## R1 — Prisma Schema

**File**: `prisma/schema.prisma`

### Enums to Remove
- `KraState` (line 133–137)
- `KpiMeasurementType` (line 139–145) — replaced with expanded version

### R1 Enums

```prisma
enum KpiMeasurementType {
  NUMERIC          // count of items (publications, patents)
  PERCENTAGE       // pass rate, attendance
  CURRENCY         // grant amount, revenue
  BOOLEAN          // yes/no (accreditation obtained)
  RATING           // 1-5 scale
  MILESTONE        // NOT_STARTED → IN_PROGRESS → COMPLETED
  DATE_TARGET      // deadline compliance
  GRADE            // qualitative scale (Outstanding...Poor)
}

enum KraCategoryScope {
  GLOBAL           // superadmin-managed, visible to all tenants
  TENANT           // tenant-created
}

enum AssessmentPeriodState {
  DRAFT
  OPEN             // targets can be set
  IN_PROGRESS      // targets locked, achievements recorded
  UNDER_REVIEW     // verification happening
  CLOSED           // finalized, read-only
  ARCHIVED
}

enum AssessmentPeriodType {
  CALENDAR_YEAR    // Jan-Dec
  FINANCIAL_YEAR   // Apr-Mar (configurable)
  SPECIFIC_RANGE   // custom start/end
}

enum ReviewCycleFrequency {
  DAILY
  WEEKLY
  MONTHLY
  QUARTERLY
  HALF_YEARLY
  ANNUAL
}

enum KraDefinitionState {
  DRAFT
  ACTIVE
  ARCHIVED
}

enum KpiDefinitionState {
  DRAFT
  ACTIVE
  ARCHIVED
}

enum KpiAllocationType {
  DEPARTMENT       // stays at dept level, head owns it
  INDIVIDUAL       // must be split to individual members
  BOTH             // head decides whether to keep or split
}

enum TargetAllocationState {
  ACTIVE           // final value entered, target is live
  LOCKED           // frozen after deadline, no changes
}

enum AchievementState {
  DRAFT            // being filled in
  SUBMITTED        // submitted for verification
  VERIFIED         // approved
  REJECTED         // sent back with reason
}

enum ScoringMethod {
  LINEAR           // actual/target * 100
  THRESHOLD        // below = 0, above = 100
  SLAB             // defined ranges
}

enum ScoringDirection {
  ASCENDING        // higher actual = better (publications, revenue)
  DESCENDING       // lower actual = better (attrition, defects, costs)
}

enum MilestoneStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
}

enum GradeValue {
  OUTSTANDING
  VERY_GOOD
  GOOD
  SATISFACTORY
  NEEDS_IMPROVEMENT
  POOR
}
```

### R1 Models (5 new, replace old Kra/Kpi)

#### 1. KraCategoryDefinition
```prisma
model KraCategoryDefinition {
  id              String           @id @default(cuid())
  tenantId        String?          // null = global (superadmin)
  scope           KraCategoryScope @default(TENANT)
  categoryKey     String           // "RESEARCH", "FINANCIAL"
  displayLabel    String
  description     String?
  iconName        String?          // lucide icon name for UI
  colorHex        String?          // dashboard color
  sortOrder       Int              @default(0)
  isActive        Boolean          @default(true)
  createdByUserId String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  tenant          Tenant?          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  kraDefinitions  KraDefinition[]

  @@unique([tenantId, categoryKey])
  @@index([scope, isActive])
}
```

#### 2. AssessmentPeriod
```prisma
model AssessmentPeriod {
  id                    String                 @id @default(cuid())
  tenantId              String
  name                  String                 // "AY 2025-26"
  code                  String                 // "AY2025-26"
  periodType            AssessmentPeriodType   @default(SPECIFIC_RANGE)
  startDate             DateTime
  endDate               DateTime
  state                 AssessmentPeriodState  @default(DRAFT)
  reviewFrequency       ReviewCycleFrequency   @default(ANNUAL)
  targetSettingDeadline DateTime?
  achievementDeadline   DateTime?
  reviewDeadline        DateTime?
  description           String?
  createdByUserId       String?
  createdAt             DateTime               @default(now())
  updatedAt             DateTime               @updatedAt
  tenant                Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  kraDefinitions        KraDefinition[]
  targetAllocations     TargetAllocation[]

  @@unique([tenantId, code])
  @@index([tenantId, state])
}
```
Note: ReviewCycle sub-periods are **computed on the fly** from periodType + reviewFrequency in the service layer. No ReviewCycle table in R1.

#### 3. KraDefinition (replaces old Kra)
```prisma
model KraDefinition {
  id              String              @id @default(cuid())
  tenantId        String
  periodId        String
  categoryId      String?
  title           String
  description     String?
  weightage       Int                 @default(0)  // integer, out of org total 100
  state           KraDefinitionState  @default(DRAFT)
  sortOrder       Int                 @default(0)
  createdByUserId String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  tenant          Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  period          AssessmentPeriod    @relation(fields: [periodId], references: [id], onDelete: Restrict)
  category        KraCategoryDefinition? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  kpiDefinitions  KpiDefinition[]

  @@index([tenantId, periodId])
  @@index([tenantId, state])
}
```

#### 4. KpiDefinition (replaces old Kpi) — R1 Simplified Version
R1 has **12 fields** — the core measurement, scoring, and allocation fields. R2/R3 add nullable columns for workflow, stages, SOP, evidence, team, rewards.
```prisma
model KpiDefinition {
  id                String             @id @default(cuid())
  kraDefinitionId   String
  title             String
  description       String?
  // ── Measurement ──
  measurementType   KpiMeasurementType @default(NUMERIC)
  unitLabel         String?            // "count", "%", "INR", "days"
  weightage         Int                @default(0)  // must sum to parent KRA's weightage
  defaultTarget     Float?
  measurementConfig Json?              // Zod-validated per type
  // ── Scoring ──
  scoringMethod     ScoringMethod      @default(LINEAR)
  scoringDirection  ScoringDirection   @default(ASCENDING)
  scoringConfig     Json?              // Zod-validated per method
  isPerCapita       Boolean            @default(false)
  // ── Allocation ──
  allocationType    KpiAllocationType  @default(BOTH)
  startingUnitId    String             // originating department
  // ── State ──
  state             KpiDefinitionState @default(DRAFT)
  sortOrder         Int                @default(0)
  guidanceNotes     String?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  kraDefinition     KraDefinition      @relation(fields: [kraDefinitionId], references: [id], onDelete: Cascade)
  startingUnit      OrgUnit            @relation("KpiStartingUnit", fields: [startingUnitId], references: [id], onDelete: Restrict)
  targetAllocations TargetAllocation[]
  achievements      Achievement[]

  @@index([kraDefinitionId])
  @@index([startingUnitId])
}
```

#### 5. TargetAllocation — R1 Simplified
No 4-dept flow, no verifier override, no stage progress. Just assign target → lock.
```prisma
model TargetAllocation {
  id                 String                @id @default(cuid())
  tenantId           String
  periodId           String
  kpiDefinitionId    String
  assignedToUnitId   String?
  assignedToUserId   String?
  allocatedByUserId  String
  // Target (polymorphic by measurement type)
  targetValue        Float?
  targetDate         DateTime?
  targetMilestone    MilestoneStatus?
  targetGrade        GradeValue?
  targetBoolean      Boolean?
  targetRating       Int?
  // State
  state              TargetAllocationState @default(ACTIVE)
  lockedAt           DateTime?
  // Cascade lineage
  parentAllocationId String?
  notes              String?
  createdAt          DateTime              @default(now())
  updatedAt          DateTime              @updatedAt
  tenant             Tenant                @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  period             AssessmentPeriod      @relation(fields: [periodId], references: [id], onDelete: Restrict)
  kpiDefinition      KpiDefinition         @relation(fields: [kpiDefinitionId], references: [id], onDelete: Restrict)
  assignedToUnit     OrgUnit?              @relation("TargetUnit", fields: [assignedToUnitId], references: [id], onDelete: SetNull)
  assignedToUser     User?                 @relation("TargetUser", fields: [assignedToUserId], references: [id], onDelete: SetNull)
  parentAllocation   TargetAllocation?     @relation("CascadeParent", fields: [parentAllocationId], references: [id], onDelete: SetNull)
  childAllocations   TargetAllocation[]    @relation("CascadeParent")
  achievements       Achievement[]

  @@index([tenantId, periodId, kpiDefinitionId])
  @@index([assignedToUnitId, periodId])
  @@index([assignedToUserId, periodId])
  @@index([parentAllocationId])
}
```

#### 6. Achievement — R1 Simplified
No reverse-route verification chain, no team contributors, no file uploads. Just record actuals with basic verification.
```prisma
model Achievement {
  id                    String             @id @default(cuid())
  tenantId              String
  periodId              String
  kpiDefinitionId       String
  targetAllocationId    String?
  reportedByUserId      String
  // Actuals (polymorphic)
  actualValue           Float?
  actualDate            DateTime?
  actualMilestone       MilestoneStatus?
  actualGrade           GradeValue?
  actualBoolean         Boolean?
  actualRating          Int?
  // Evidence (simple text in R1, file uploads added in R2)
  evidenceDescription   String?
  evidenceLinks         String[]           // URLs for now, file uploads in R2
  // Scoring
  computedScore         Float?             // 0-100
  // Verification (simple in R1, reverse-route chain in R2)
  state                 AchievementState   @default(DRAFT)
  verifiedByUserId      String?
  verifiedAt            DateTime?
  verificationNote      String?
  rejectionReason       String?
  reportingDate         DateTime           @default(now())
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt
  tenant                Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  kpiDefinition         KpiDefinition      @relation(fields: [kpiDefinitionId], references: [id], onDelete: Restrict)
  targetAllocation      TargetAllocation?  @relation(fields: [targetAllocationId], references: [id], onDelete: SetNull)

  @@index([tenantId, periodId])
  @@index([targetAllocationId])
  @@index([reportedByUserId, periodId])
  @@index([tenantId, state])
}
```

### R1 Relations on Existing Models

**Tenant**: add `assessmentPeriods[], kraCategories[], kraDefinitions[], targetAllocations[], achievements[]`. Remove `kras Kra[]`.

**OrgUnit**: add `kpiStarting KpiDefinition[] @relation("KpiStartingUnit")`, `targetAllocations TargetAllocation[] @relation("TargetUnit")`. Remove `kras Kra[]`.

**User**: add `targetAllocations TargetAllocation[] @relation("TargetUser")`.

---

## R1 — Service Layer

**Directory**: `src/lib/kra-kpi/`

### `shared.ts`
- `KraKpiActionResult` type
- View types: `KraCategoryView`, `AssessmentPeriodView`, `KraDefinitionView`, `KpiDefinitionView`, `TargetAllocationView`, `AchievementView`
- Zod discriminated unions for measurementConfig and scoringConfig
- Tooltip text constants

### `category-service.ts`
- `listCategories(tenantId)` — merges global + tenant
- `createCategory(...)`, `updateCategory(...)`, `deleteCategory(...)` — guard: no KRAs reference it

### `period-service.ts`
- `createPeriod(...)`, `updatePeriod(...)`, `listPeriods(tenantId)`
- `transitionState(periodId, newState)` — DRAFT→OPEN→IN_PROGRESS→UNDER_REVIEW→CLOSED→ARCHIVED
- `checkAndAutoLock(periodId)` — lazy lock on access
- `computeReviewCycles(period)` — returns computed sub-periods (no DB table)

### `kra-service.ts`
- CRUD for KraDefinition
- `validateKraWeightages(periodId)` — must sum to 100
- `activateKra(kraId)` — blocks if weights invalid

### `kpi-service.ts`
- CRUD for KpiDefinition (12 fields only)
- `validateKpiWeightages(kraDefinitionId)` — must sum to parent KRA's weightage

### `target-service.ts`
- `createAllocation(...)` — state=ACTIVE
- `updateAllocation(...)` — only if not LOCKED
- `lockTarget(allocationId)` — ACTIVE→LOCKED
- `bulkLockByPeriod(periodId)`
- `cascadeTargets(parentAllocationId, distribution[])` — NUMERIC/CURRENCY: sum must match; others: replicate
- `deleteAllocation(allocationId)` — only if no achievements

### `achievement-service.ts`
- `recordAchievement(values)` — basic evidence validation (description or links required if KPI needs it)
- `submitForVerification(achievementId)` — DRAFT→SUBMITTED
- `verifyAchievement(achievementId, approved, note)` — SUBMITTED→VERIFIED or REJECTED
- Rejection sets rejectionReason, resets to DRAFT for re-entry

### `scoring-service.ts` — pure functions
- `computeScore(type, method, direction, config, target, actual)` → 0–100
- All 8 measurement types × 3 scoring methods × 2 directions
- `computeWeightedOverallScore(kpiScores[])` — uses absolute weightages

---

## R1 — API Routes

```
src/app/api/
  superadmin/
    kra-categories/route.ts                    GET, POST
    kra-categories/[id]/route.ts               PATCH, DELETE

  tenant/kra-kpi/
    categories/route.ts                        GET (merged), POST
    categories/[id]/route.ts                   PATCH, DELETE
    periods/route.ts                           GET, POST
    periods/[id]/route.ts                      GET, PATCH
    periods/[id]/transition/route.ts           POST
    periods/[id]/lock-targets/route.ts         POST
    kras/route.ts                              GET, POST
    kras/[id]/route.ts                         GET, PATCH, DELETE
    kras/[id]/activate/route.ts                POST
    kras/[id]/validate-weights/route.ts        GET
    kpis/route.ts                              GET, POST
    kpis/[id]/route.ts                         PATCH, DELETE
    targets/route.ts                           GET, POST
    targets/[id]/route.ts                      PATCH, DELETE
    targets/[id]/lock/route.ts                 POST
    targets/[id]/cascade/route.ts              POST
    targets/bulk-lock/route.ts                 POST
    achievements/route.ts                      GET, POST
    achievements/[id]/route.ts                 PATCH
    achievements/[id]/submit/route.ts          POST
    achievements/[id]/verify/route.ts          POST
    summary/route.ts                           GET (dashboard rollup)
```

**Total: ~25 route files** — same scale as the existing roles module.

---

## R1 — Frontend Components

```
src/components/tenant/kra-kpi/
├── tooltip-hint.tsx                  Reusable hover tooltip
├── assessment-period-list.tsx        List/create/edit periods
├── assessment-period-form.tsx        Period form with dates + deadlines
├── kra-category-list.tsx             Categories (global vs tenant)
├── kra-definition-list.tsx           KRAs with weightage bar
├── kra-definition-form.tsx           Create/edit KRA
├── kpi-definition-list.tsx           KPIs under KRA
├── kpi-definition-form.tsx           Core form: measurement, scoring, allocation type
├── target-allocation-table.tsx       Tree-table with cascade
├── target-allocation-form.tsx        Assign final target values
├── target-cascade-form.tsx           Split parent to children
├── achievement-form.tsx              Record actuals + basic evidence
├── achievement-review-list.tsx       Pending verifications
├── kpi-score-card.tsx                Score display
├── period-dashboard.tsx              Rollup summary
```

**Total: ~15 components.** KPI form has ~12 fields, not 25.

---

## R1 — Build Order

| Step | What | Depends On |
|---|---|---|
| 1 | Schema migration: remove old Kra/Kpi, add 5 R1 models + enums | — |
| 2 | `shared.ts`: types, Zod unions, tooltips | Step 1 |
| 3 | `scoring-service.ts` (pure functions, no DB) | — |
| 4 | `category-service.ts` + API + UI | Step 2 |
| 5 | `period-service.ts` + API + UI | Step 2 |
| 6 | `kra-service.ts` + API + UI | Steps 4, 5 |
| 7 | `kpi-service.ts` + API + UI | Step 6 |
| 8 | `target-service.ts` + API + UI | Step 7 |
| 9 | `achievement-service.ts` + API + UI | Steps 3, 8 |
| 10 | Dashboard summary API + UI | Steps 8, 9 |

## R1 — Verification

1. `npx prisma migrate dev` — 5 models created, no errors
2. Create categories (global + tenant) → merged listing works
3. Create period (Calendar Year, Financial Year, Specific Range) → state transitions work
4. Create KRA weightage=30 → KPIs summing to 30 → activation passes
5. KRA with wrong KPI sum → activation blocked
6. Try deleting KRA with allocations → blocked (must archive)
7. Allocate target to dept → cascade to 5 faculty → sum matches
8. Record achievement → submit → verify → score computed correctly
9. Test DESCENDING scoring: target attrition 15%, actual 10% → score > 100% capped at 100
10. `npm run build` passes

---

## R1 — Weightage Rules

```
Organization Total = 100

KRA: Research = 30
  ├── KPI: Publications = 15
  ├── KPI: Patents = 10
  └── KPI: Grants = 5          sum = 30 ✓

KRA: Teaching = 40
  ├── KPI: Feedback = 20
  └── KPI: Pass rate = 20      sum = 40 ✓

KRA: Community = 30
  └── KPI: MoUs = 30           sum = 30 ✓

Total = 100 ✓
```

Score: `KPI Score × (KPI weightage / 100)`, sum of all = Overall Score (max 100).

---

# ═══════════════════════════════════════════════════════════════════════════════
# RELEASE 2: Workflow + Verification + Files (7 models added, ~4-5 days)
# Adds: 4-dept flow, multi-target units, stages, SOP, file uploads, reverse-route verification
# ═══════════════════════════════════════════════════════════════════════════════

## R2 — Schema Changes (non-breaking migrations)

### R2 Enums Added

```prisma
enum KpiFlowStatus {
  CREATED
  ASSIGNED
  IN_PROGRESS
  SUBMITTED
  KEY_REVIEW
  KEY_APPROVED
  KEY_REJECTED
  FINAL_REVIEW
  VERIFIED
  REJECTED
}

enum EvidenceType {
  DOCUMENT
  URL
  CERTIFICATE
  SELF_DECLARATION
  SYSTEM_GENERATED
  NONE
}

enum TeamCreditMethod {
  FULL_EACH
  EQUAL_SPLIT
  WEIGHTED_SPLIT
  PRIMARY_ONLY
}
```

### R2 New Fields on KpiDefinition (nullable columns — non-breaking)
```prisma
// Add to KpiDefinition:
  keyUnitId         String?            // validates completion
  finalUnitId       String?            // final verification
  sopDescription    String?
  sopFiles          Json?              // [{fileKey, fileName, fileType, uploadedAt}]
  evidenceRequired  Boolean            @default(true)
  evidenceTypes     EvidenceType[]
  evidenceInstructions String?
  isTeamKpi         Boolean            @default(false)
  teamCreditMethod  TeamCreditMethod   @default(FULL_EACH)
  // Relations:
  keyUnit           OrgUnit?           @relation("KpiKeyUnit")
  finalUnit         OrgUnit?           @relation("KpiFinalUnit")
  targetUnits       KpiTargetUnit[]
  stages            KpiStageDefinition[]
```

### R2 New Fields on TargetAllocation (nullable — non-breaking)
```prisma
// Add to TargetAllocation:
  flowStatus             KpiFlowStatus   @default(CREATED)
  flowLog                Json?
  verifierOverrideUserId String?
  verifierOverrideNote   String?
  teamWeights            Json?
  stageProgress          KpiStageProgress[]
```

### R2 New Fields on Achievement (nullable — non-breaking)
```prisma
// Add to Achievement:
  evidenceFiles         Json?           // [{fileKey, fileName, fileType, uploadedAt}]
  verificationLog       Json?           // [{level, verifierUserId, action, note, timestamp}]
  currentVerifierUserId String?
  currentVerifierUnitId String?
  isTeamAchievement     Boolean         @default(false)
```

### R2 New Models (4 new)

#### KpiTargetUnit
```prisma
model KpiTargetUnit {
  id              String        @id @default(cuid())
  kpiDefinitionId String
  unitId          String
  targetShare     Float?
  notes           String?
  createdAt       DateTime      @default(now())
  kpiDefinition   KpiDefinition @relation(fields: [kpiDefinitionId], references: [id], onDelete: Cascade)
  unit            OrgUnit       @relation("KpiTargetUnits", fields: [unitId], references: [id], onDelete: Cascade)

  @@unique([kpiDefinitionId, unitId])
  @@index([unitId])
}
```

#### KpiStageDefinition
```prisma
model KpiStageDefinition {
  id              String        @id @default(cuid())
  kpiDefinitionId String
  stageOrder      Int
  title           String
  description     String?
  isMandatory     Boolean       @default(true)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  kpiDefinition   KpiDefinition @relation(fields: [kpiDefinitionId], references: [id], onDelete: Cascade)
  stageProgress   KpiStageProgress[]

  @@unique([kpiDefinitionId, stageOrder])
  @@index([kpiDefinitionId])
}
```

#### KpiStageProgress
```prisma
model KpiStageProgress {
  id                  String             @id @default(cuid())
  targetAllocationId  String
  stageDefinitionId   String
  isCompleted         Boolean            @default(false)
  completedByUserId   String?
  completedAt         DateTime?
  evidenceNote        String?
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt
  targetAllocation    TargetAllocation   @relation(fields: [targetAllocationId], references: [id], onDelete: Cascade)
  stageDefinition     KpiStageDefinition @relation(fields: [stageDefinitionId], references: [id], onDelete: Cascade)

  @@unique([targetAllocationId, stageDefinitionId])
  @@index([targetAllocationId])
}
```

#### ReviewCycle (now a stored table for sub-period tracking)
```prisma
model ReviewCycle {
  id             String           @id @default(cuid())
  periodId       String
  cycleNumber    Int
  label          String           // "Q1", "H1", "Week 12"
  startDate      DateTime
  endDate        DateTime
  reviewDeadline DateTime?
  isCurrent      Boolean          @default(false)
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  period         AssessmentPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)

  @@unique([periodId, cycleNumber])
  @@index([periodId, isCurrent])
}
```

### R2 Relations on Existing Models
**OrgUnit**: add `kpiKey[], kpiFinal[], kpiTarget KpiTargetUnit[]`

---

## R2 — Service Layer Additions

### `file-upload-service.ts` (NEW)
- `uploadFile(file, context, entityId)` → fileKey
- `listFiles(entityType, entityId)`, `deleteFile(fileKey)`, `getFileUrl(fileKey)`
- Accepted: `.pdf`, `.doc`, `.docx`, `.jpg`, `.jpeg`, `.png`. Max 10MB.

### `kpi-service.ts` (EXTEND)
- `addTargetUnit(kpiId, unitId, targetShare?)`
- `removeTargetUnit(kpiId, unitId)`
- `addStage(kpiId, {stageOrder, title, ...})`
- `removeStage(kpiId, stageId)`
- `uploadSop(kpiId, files[])`, `removeSopFile(kpiId, fileKey)`

### `target-service.ts` (EXTEND)
- `setVerifierOverride(allocationId, overrideUserId, note)`
- `advanceFlowStatus(allocationId, newStatus, note)` — 4-dept state machine
- `updateStageProgress(allocationId, stageDefId, completed, evidence?)`

### `achievement-service.ts` (EXTEND)
- `submitForVerification()` — now builds reverse-route verification chain
- `verifyAtCurrentLevel()` — advances through chain or rejects back
- `recordTeamAchievement(values, contributors[])` — team support
- File upload evidence validation

### `period-service.ts` (EXTEND)
- `generateReviewCycles(periodId)` — creates ReviewCycle records from frequency

---

## R2 — API Routes Added

```
  tenant/kra-kpi/
    kpis/[id]/target-units/route.ts            GET, POST, DELETE
    kpis/[id]/stages/route.ts                  GET, POST
    kpis/[id]/stages/[stageId]/route.ts        PATCH, DELETE
    targets/[id]/verifier-override/route.ts    PATCH
    targets/[id]/flow/route.ts                 POST
    targets/[id]/stages/[stageId]/route.ts     PATCH
    files/upload/route.ts                      POST
    files/[fileKey]/route.ts                   GET, DELETE
```

## R2 — Frontend Components Added

```
├── kpi-stage-editor.tsx              Ordered stage management
├── target-flow-tracker.tsx           Visual 4-dept flow with status
├── target-verifier-override.tsx      Override verifier
├── file-upload.tsx                   Reusable multi-file upload
├── achievement-review-list.tsx       (enhanced: reverse-route queue)
├── kpi-definition-form.tsx           (enhanced: +stages, +SOP, +evidence, +team sections)
```

## R2 — 4-Department Flow

```
ALLOCATION (downward):
┌──────────┐     ┌──────────┐
│ Starting │────▶│  Target  │──── Can split to members
│   Dept   │     │ Dept(s)  │     if allocationType ≠ DEPARTMENT
└──────────┘     └──────────┘

VERIFICATION (upward — reverse route):
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Target  │────▶│   Key    │────▶│ Starting │
│(Submits) │     │(Validate)│     │(Verify)  │
└──────────┘     └────┬─────┘     └──────────┘
      ▲               │
      └───REJECTED────┘

Flow: CREATED→ASSIGNED→IN_PROGRESS→SUBMITTED→KEY_REVIEW→KEY_APPROVED→FINAL_REVIEW→VERIFIED
Key/Final depts are optional. If null, skip that step.
```

## R2 — Verification

1. Migration adds columns + 4 new tables — no data loss
2. Add target units to KPI → multi-dept cascade works
3. Add stages to KPI → stage progress tracked per allocation
4. Upload SOP files → stored, retrievable, deletable
5. Upload evidence files with achievement → validation works
6. 4-dept flow: ASSIGNED→IN_PROGRESS→SUBMITTED→KEY_REVIEW→KEY_REJECTED→back to IN_PROGRESS→resubmit→VERIFIED
7. Verifier override → routes to overridden user
8. Reverse-route verification chain works end-to-end
9. Team achievement → credit split per method
10. `npm run build` passes

---

# ═══════════════════════════════════════════════════════════════════════════════
# RELEASE 3: Rewards + Accreditation (8 models added, ~4-5 days)
# Adds: contributor roles, rewards, accreditation mapping
# ═══════════════════════════════════════════════════════════════════════════════

## R3 — Schema Changes

### R3 Enums Added

```prisma
enum AccreditationScope {
  GLOBAL
  TENANT
}

enum RewardType {
  MONETARY
  RESEARCH_POINTS
  CREDIT_HOURS
  CERTIFICATE
  CUSTOM
}

enum RewardDistributionMethod {
  FIXED_PERCENTAGE
  EQUAL_SHARE_OF_REMAINDER
  FIXED_AMOUNT
  PERCENTAGE_OF_ACHIEVEMENT
}

enum RewardState {
  PENDING
  APPROVED
  CANCELLED
}
```

### R3 New Models (8 new)

#### AccreditationBody
```prisma
model AccreditationBody {
  id              String              @id @default(cuid())
  tenantId        String?             // null = global
  scope           AccreditationScope  @default(GLOBAL)
  code            String
  name            String
  country         String?
  description     String?
  isActive        Boolean             @default(true)
  createdByUserId String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  tenant          Tenant?             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  criteria        AccreditationCriterion[]

  @@unique([tenantId, code])
  @@index([scope, isActive])
}
```

#### AccreditationCriterion
```prisma
model AccreditationCriterion {
  id              String             @id @default(cuid())
  bodyId          String
  criterionCode   String
  title           String
  description     String?
  section         String?
  maxScore        Float?
  sortOrder       Int                @default(0)
  isActive        Boolean            @default(true)
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt
  body            AccreditationBody  @relation(fields: [bodyId], references: [id], onDelete: Cascade)
  kpiMappings     KpiAccreditationMapping[]

  @@unique([bodyId, criterionCode])
  @@index([bodyId, sortOrder])
}
```

#### KpiAccreditationMapping
```prisma
model KpiAccreditationMapping {
  id              String                 @id @default(cuid())
  kpiDefinitionId String
  criterionId     String
  notes           String?
  createdAt       DateTime               @default(now())
  kpiDefinition   KpiDefinition          @relation(fields: [kpiDefinitionId], references: [id], onDelete: Cascade)
  criterion       AccreditationCriterion @relation(fields: [criterionId], references: [id], onDelete: Cascade)

  @@unique([kpiDefinitionId, criterionId])
  @@index([criterionId])
}
```

#### KpiContributorRole
```prisma
model KpiContributorRole {
  id              String        @id @default(cuid())
  kpiDefinitionId String
  roleKey         String
  displayLabel    String
  description     String?
  sortOrder       Int           @default(0)
  isActive        Boolean       @default(true)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  kpiDefinition   KpiDefinition @relation(fields: [kpiDefinitionId], references: [id], onDelete: Cascade)
  rewardDistributions KpiRewardDistribution[]
  achievementContributors AchievementContributor[]

  @@unique([kpiDefinitionId, roleKey])
  @@index([kpiDefinitionId])
}
```

#### KpiRewardDefinition
```prisma
model KpiRewardDefinition {
  id              String        @id @default(cuid())
  kpiDefinitionId String
  rewardType      RewardType    @default(MONETARY)
  rewardLabel     String
  currencyCode    String?
  amountPerUnit   Float
  customUnit      String?
  isActive        Boolean       @default(true)
  sortOrder       Int           @default(0)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  kpiDefinition   KpiDefinition @relation(fields: [kpiDefinitionId], references: [id], onDelete: Cascade)
  distributions   KpiRewardDistribution[]
  achievementRewards AchievementReward[]

  @@index([kpiDefinitionId])
}
```

#### KpiRewardDistribution
```prisma
model KpiRewardDistribution {
  id                    String                    @id @default(cuid())
  rewardDefinitionId    String
  contributorRoleId     String
  distributionMethod    RewardDistributionMethod  @default(FIXED_PERCENTAGE)
  percentage            Float?
  fixedAmount           Float?
  notes                 String?
  createdAt             DateTime                  @default(now())
  updatedAt             DateTime                  @updatedAt
  rewardDefinition      KpiRewardDefinition       @relation(fields: [rewardDefinitionId], references: [id], onDelete: Cascade)
  contributorRole       KpiContributorRole        @relation(fields: [contributorRoleId], references: [id], onDelete: Cascade)

  @@unique([rewardDefinitionId, contributorRoleId])
  @@index([rewardDefinitionId])
}
```

#### AchievementContributor
```prisma
model AchievementContributor {
  id                  String              @id @default(cuid())
  achievementId       String
  userId              String
  contributorRoleId   String
  isPrimary           Boolean             @default(false)
  createdAt           DateTime            @default(now())
  achievement         Achievement         @relation(fields: [achievementId], references: [id], onDelete: Cascade)
  user                User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  contributorRole     KpiContributorRole  @relation(fields: [contributorRoleId], references: [id], onDelete: Restrict)
  rewards             AchievementReward[]

  @@unique([achievementId, userId])
  @@index([achievementId])
  @@index([userId])
}
```

#### AchievementReward
```prisma
model AchievementReward {
  id                    String                @id @default(cuid())
  achievementId         String
  rewardDefinitionId    String
  contributorId         String
  userId                String
  contributorRoleId     String
  calculatedAmount      Float
  rewardUnit            String
  state                 RewardState           @default(PENDING)
  notes                 String?
  createdAt             DateTime              @default(now())
  updatedAt             DateTime              @updatedAt
  achievement           Achievement           @relation(fields: [achievementId], references: [id], onDelete: Cascade)
  rewardDefinition      KpiRewardDefinition   @relation(fields: [rewardDefinitionId], references: [id], onDelete: Restrict)
  contributor           AchievementContributor @relation(fields: [contributorId], references: [id], onDelete: Cascade)

  @@index([achievementId])
  @@index([userId])
  @@index([state])
}
```

### R3 Relations Added
- **KpiDefinition**: add `accreditationMappings[], contributorRoles[], rewardDefinitions[]`
- **Achievement**: add `contributors AchievementContributor[], rewards AchievementReward[]`
- **Tenant**: add `accreditationBodies[]`
- **User**: add `achievementContributions AchievementContributor[]`

---

## R3 — Service Layer

### `accreditation-service.ts` (NEW)
- `listBodies(tenantId)` — merges global + tenant
- `createBody(...)`, `updateBody(...)` — superadmin for global, tenant admin for custom
- `listCriteria(bodyId)`, `createCriterion(...)`, `updateCriterion(...)`

### `kpi-service.ts` (EXTEND)
- `mapAccreditation(kpiId, criterionId, notes?)`
- `unmapAccreditation(kpiId, criterionId)`
- `addContributorRole(kpiId, {roleKey, displayLabel})`
- `removeContributorRole(kpiId, roleId)` — only if no achievements use it

### `reward-service.ts` (NEW)
- `addRewardDefinition(kpiId, {...})`, `updateRewardDefinition(...)`, `removeRewardDefinition(...)`
- `addRewardDistribution(rewardId, {...})`, `updateRewardDistribution(...)`, `removeRewardDistribution(...)`
- `validateDistribution(rewardId)` — FIXED_PERCENTAGE sums + EQUAL_SHARE_OF_REMAINDER covers 100%

### `reward-calculation-service.ts` (NEW — pure functions)
- `calculateRewards(achievement, contributors[], rewardDefs[], distributions[])`:
  - FIXED_PERCENTAGE: `pool × percentage / 100`
  - EQUAL_SHARE_OF_REMAINDER: `remainder / count(role)`
  - FIXED_AMOUNT: `fixedAmount`
  - PERCENTAGE_OF_ACHIEVEMENT: `actualValue × percentage / 100`
- Auto-triggered when achievement reaches VERIFIED

### `achievement-service.ts` (EXTEND)
- `recordTeamAchievement(...)` — now creates AchievementContributor records with proper roles
- On VERIFIED → auto-calls `calculateRewards()` → creates AchievementReward records

---

## R3 — API Routes Added

```
  superadmin/
    accreditation/bodies/route.ts              GET, POST
    accreditation/bodies/[id]/route.ts         PATCH, DELETE
    accreditation/criteria/route.ts            GET, POST
    accreditation/criteria/[id]/route.ts       PATCH, DELETE

  tenant/kra-kpi/
    accreditation/bodies/route.ts              GET (merged), POST
    accreditation/bodies/[id]/route.ts         PATCH, DELETE
    accreditation/criteria/route.ts            GET, POST
    accreditation/criteria/[id]/route.ts       PATCH, DELETE
    kpis/[id]/accreditation/route.ts           GET, POST, DELETE
    kpis/[id]/contributor-roles/route.ts       GET, POST
    kpis/[id]/contributor-roles/[roleId]/route.ts  PATCH, DELETE
    kpis/[id]/rewards/route.ts                 GET, POST
    kpis/[id]/rewards/[rewardId]/route.ts      PATCH, DELETE
    kpis/[id]/rewards/[rewardId]/distribution/route.ts  GET, POST
    kpis/[id]/rewards/[rewardId]/distribution/[distId]/route.ts  PATCH, DELETE
    kpis/[id]/rewards/[rewardId]/validate/route.ts  GET
```

## R3 — Frontend Components Added

```
├── accreditation-body-list.tsx        Manage bodies + criteria
├── kpi-accreditation-mapper.tsx       Map KPI to criteria
├── kpi-contributor-roles.tsx          Define contributor roles
├── kpi-reward-definition.tsx          Define rewards per KPI
├── kpi-reward-distribution.tsx        70/30 split editor
├── achievement-contributor-form.tsx   Select contributors + roles
├── achievement-reward-summary.tsx     Calculated rewards display
```

## R3 — Verification

1. Migration adds 8 tables + columns — no data loss, R1/R2 features unchanged
2. Create accreditation body (NAAC) + criterion (3.2.2) → merged listing works
3. Map KPI to NAAC 3.2.2 + NIRF 1.2 → appears on both
4. Define contributor roles: FIRST_AUTHOR, CO_AUTHOR
5. Define reward: MONETARY ₹35K, FIRST_AUTHOR=70%, CO_AUTHOR=EQUAL_SHARE_OF_REMAINDER
6. Validate distribution = 100%
7. Record team achievement: Prof A (FIRST_AUTHOR), Prof B (CO_AUTHOR), Prof C (CO_AUTHOR)
8. Verify → AchievementReward auto-generated:
   - Prof A: ₹24,500 + 7 points
   - Prof B: ₹5,250 + 1.5 points
   - Prof C: ₹5,250 + 1.5 points
   - Total: ₹35,000 + 10 points ✓
9. Single-author → gets 100% (no co-authors to share with)
10. `npm run build` passes

---

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

| Release | Models | Time | What You Get |
|---|---|---|---|
| **R1** | 5 new (+1 replaced) | 3-4 days | Create KRAs/KPIs, set targets, cascade, record achievements, compute scores |
| **R2** | +4 new, extend 3 | 4-5 days | 4-dept workflow, stages, SOP files, evidence uploads, reverse-route verification, team KPIs |
| **R3** | +24 new | 10-14 days | **Standalone Accreditation Management System** — framework engine (7), assessment workspace & collaboration (12), KPI integration (2), competitive analysis + cross-check + DVV + recommendations (5) |
| **R4** | +5 new, extend 2 | 4-5 days | Contributor roles, team achievements, reward definitions, auto-reward calculation |
| **R5** | AI layer | TBD | SSR narrative generation, auto KPI-criteria mapping, evidence gap detection, predictive scoring, competitive intelligence |
| **Total** | ~36 models | ~24-30 days | Full system as designed |

Each release is **independently deployable and usable**. R2 adds nullable columns to R1 models (non-breaking). R3 adds new tables (non-breaking). R4 adds contributor/reward tables with FK to existing (non-breaking). R5 is a pure service layer, no schema changes.

**R3 Standalone Product Note**: The accreditation module is designed to be sellable as an independent SaaS product. It works in two modes: (1) Standalone — manual data entry with competitive analysis, (2) Integrated — auto-pulls data from KRA/KPI achievements with configurable filters. The KPI integration (R3.3) is optional.

---

# ═══════════════════════════════════════════════════════════════════════════════
# SUB-PLAN INDEX & STATUS
# ═══════════════════════════════════════════════════════════════════════════════

## Release 1 — Core Framework ✅ COMPLETE

| Sub-part | Plan File | Status | Tests |
|----------|-----------|--------|-------|
| R1 (full) | *(inline above)* | ✅ Done | — |
| R1.1a — Core Assignee Experience | [clever-riding-fiddle.md](clever-riding-fiddle.md) | ✅ Done | — |
| R1.2a — Engagement Discovery | [R1.2a-engagement-discovery.md](R1.2a-engagement-discovery.md) | ✅ Done | — |

## Release 2 — Workflow + Verification ✅ COMPLETE

| Sub-part | Plan File | Status | Tests |
|----------|-----------|--------|-------|
| R2.1 — Schema, Review Cycles, Target Units | [R2.1-schema-review-cycles-target-units.md](R2.1-schema-review-cycles-target-units.md) | ✅ Done | — |
| R2.2 — Stages, Submission, Approval & Dashboard | [R2.2-stages-submission-approval-dashboard.md](R2.2-stages-submission-approval-dashboard.md) | ✅ Done | 30 integration tests (r2-2-gaps.integration.test.ts) |

## Release 3 — Accreditation Management System 🔲 NEXT

> **Design philosophy**: Standalone product, sellable independently. Supports manual data entry, KPI auto-linking (hybrid), competitive benchmarking. Pre-seeded with NAAC/NIRF/NBA/QS frameworks.

| Sub-part | Plan File | Status | Depends on |
|----------|-----------|--------|------------|
| R3.1 — Framework & Criteria Engine (7 models) | [R3.1-accreditation-framework-criteria-engine.md](R3.1-accreditation-framework-criteria-engine.md) | 🔲 Not started | Nothing (foundation) |
| R3.2 — Assessment Workspace, Score Engine & Collaboration (12 models) | [R3.2-assessment-workspace-score-engine.md](R3.2-assessment-workspace-score-engine.md) | 🔲 Not started | R3.1 |
| R3.3 — KPI Integration & Smart Linking (2 models) | [R3.3-kpi-integration-smart-linking.md](R3.3-kpi-integration-smart-linking.md) | 🔲 Not started | R3.1 + R3.2 |
| R3.4 — Competitive Analysis, Cross-Check Intelligence & Reporting (5 models) | [R3.4-competitive-analysis-reporting.md](R3.4-competitive-analysis-reporting.md) | 🔲 Not started | R3.1 + R3.2 |

## Release 4 — Contributor Roles & Rewards 🔲 FUTURE

| Sub-part | Plan File | Status | Depends on |
|----------|-----------|--------|------------|
| R4.1 — Contributor Roles & Team Achievements | [R4.1-contributor-roles-team-achievements.md](R4.1-contributor-roles-team-achievements.md) | 🔲 Not started | Standalone |
| R4.2 — Rewards, Distribution & Auto-Calculation | [R4.2-rewards-distribution-auto-calculation.md](R4.2-rewards-distribution-auto-calculation.md) | 🔲 Not started | R4.1 |

## Release 5 — AI Layer 🔲 FUTURE

| Feature | Status | Depends on |
|---------|--------|------------|
| SSR Narrative Generation | 🔲 Deferred | R3.2 |
| Auto KPI-to-Criteria Mapping | 🔲 Deferred | R3.3 |
| Evidence Gap Detection | 🔲 Deferred | R3.2 |
| Predictive Scoring Advisor | 🔲 Deferred | R3.2 |
| Document Data Extraction (Vision API) | 🔲 Deferred | R3.2 |
| Competitive Intelligence Summary | 🔲 Deferred | R3.4 |
| DVV Prep Assistant | 🔲 Deferred | R3.2 |

---

## What We Skip Entirely
- KPI dependencies (B requires A)
- Formula/computed KPIs
- Global KRA/KPI templates (framework first, templates later)
- Email/push notifications
- Cross-period trend analysis
- Bulk achievement import
- Reward disbursement tracking (payment processing, payroll integration)
