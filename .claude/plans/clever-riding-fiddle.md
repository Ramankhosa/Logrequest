# R1.1 — Assignee-Facing KRA/KPI Experience

## Context

R1 built the KRA/KPI system from the **admin perspective** only (`/tenant-admin/kra-kpi`). There is no view for department heads or individual users to see allocated KPIs, record achievements with structured proof, or send them up for verification. R1.1 adds the complete assignee-facing experience in two parts:

- **R1.1a**: Core assignee view, 2-level verification, dynamic achievement forms, filters, cascade powers, review queue
- **R1.1b**: Additional achievements tab, notification system, workspace dashboard bubble, bulk actions, category quick-access

---

# ═══════════════════════════════════════════════════════════════════════════════
# R1.1a — Core Assignee Experience
# ═══════════════════════════════════════════════════════════════════════════════

## 1. Schema Changes

**File**: `prisma/schema.prisma`

### New Enum Value

```prisma
enum AchievementState {
  DRAFT
  SUBMITTED
  RECOMMENDED       // NEW — dept head has endorsed
  VERIFIED
  REJECTED           // displayed as "Not Approved" in UI
}
```

### New Enum

```prisma
enum AchievementFieldType {
  TEXT
  TEXTAREA
  NUMBER
  DATE
  URL
  EMAIL
  SELECT
  MULTI_SELECT
  BOOLEAN
  FILE_LINK
}
```

### New Fields on KpiDefinition (nullable — non-breaking)

```prisma
// Add to KpiDefinition:
  achievementTemplateKey  String?    // "PUBLICATION", "PATENT", etc.
  achievementFormConfig   Json?      // [{key, label, type, required, options?, pattern?}]
```

### New Fields on Achievement (nullable — non-breaking)

```prisma
// Add to Achievement:
  achievementFormData       Json?      // filled-in custom fields per KPI template
  recommendedByUserId       String?
  recommendedAt             DateTime?
  recommendationNote        String?
  verificationLog           Json?      // [{level, userId, userName, action, note, at}]
```

### New Model: Notification

```prisma
model Notification {
  id          String   @id @default(cuid())
  tenantId    String
  userId      String   // recipient
  type        String   // "KPI_ALLOCATED", "ACHIEVEMENT_VERIFIED", etc.
  title       String
  message     String
  entityType  String?  // "Achievement", "TargetAllocation"
  entityId    String?
  linkUrl     String?  // deep link to the relevant page
  isRead      Boolean  @default(false)
  createdAt   DateTime @default(now())
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRead, createdAt])
  @@index([tenantId, userId])
}
```

**Relations on existing models**: Add `notifications Notification[]` to Tenant and User.

---

## 2. Who Sees What

### Resolving context

Use existing `getUserAssignments(tenantId, userId)` from `src/lib/org-structure/roles-service.ts:684`. Derive:

```ts
type MyKpiContext = {
  userId: string;
  headOfUnits: { unitId: string; unitName: string; unitCode: string }[];
  memberOfUnits: { unitId: string; unitName: string; unitCode: string }[];
};
```

### Allocation visibility

Query `TargetAllocation` WHERE:
- `assignedToUserId = userId` (individual assignments) **OR**
- `assignedToUnitId IN headOfUnits[].unitId` (dept-level for units user heads)

Grouped in UI: "Department KPIs" (unit head) and "My Individual KPIs" (personal).

---

## 3. Powers by KpiAllocationType — All Scenarios

### A: `DEPARTMENT` type → dept

| Actor | See | Record | Cascade |
|---|---|---|---|
| Dept head | Yes | **Yes** | No (stays at dept) |
| Dept member | No | No | No |

### B: `INDIVIDUAL` type → dept

| Actor | See | Record | Cascade |
|---|---|---|---|
| Dept head | Yes + **"Must Distribute" amber banner** | **No** | **Yes, MUST** |
| Individual (after cascade) | Yes | **Yes** | No |

### C: `BOTH` type → dept

| Actor | See | Record | Cascade |
|---|---|---|---|
| Dept head (no children) | Yes + **choice UI** | Yes (if "keep at dept") | Yes (if "distribute") |
| Dept head (after cascade) | Yes + children below | **No** (children own it) | No |
| Individual (after cascade) | Yes | **Yes** | No |

### D: `INDIVIDUAL` type → user directly

| Actor | See | Record | Cascade |
|---|---|---|---|
| That user | Yes | **Yes** | No |

### E: Cascaded child allocation

| Actor | See | Record | Cascade further |
|---|---|---|---|
| Assigned user | Yes | Yes | No |
| Assigned unit head | Yes | Yes (if DEPT/BOTH) | If sub-units exist + type allows |

---

## 4. 2-Level Verification Flow

```
Faculty submits → Dept Head recommends → Source Dept Head verifies
                                          (or Not Approves)
```

### State machine

```
DRAFT → SUBMITTED → RECOMMENDED → VERIFIED
              ↑          │              │
              │     (send back)    (not approved)
              └──────────┴──────────────┘
```

### Who acts at each level

| State | Who sees it | What they can do |
|---|---|---|
| SUBMITTED | Dept head (head of assignee's unit) | **Recommend** (→ RECOMMENDED) or **Send Back** (→ DRAFT with reason) |
| RECOMMENDED | Source dept head (head of `kpiDefinition.startingUnitId`) | **Verify** (→ VERIFIED) or **Not Approve** (→ DRAFT with reason) |

### Shortcut

If assignee's unit === KPI's `startingUnitId`, skip RECOMMENDED — go directly SUBMITTED → VERIFIED/NOT_APPROVED (same person is both recommender and verifier).

### Verification log (JSON on Achievement)

```json
[
  { "level": "SUBMIT", "userId": "u1", "userName": "Dr. Kumar", "action": "submitted", "at": "2026-03-05T..." },
  { "level": "RECOMMEND", "userId": "u2", "userName": "Dr. Singh", "action": "recommended", "note": "Publications verified", "at": "2026-03-07T..." },
  { "level": "VERIFY", "userId": "u3", "userName": "Prof. Mehta", "action": "verified", "note": "Approved", "at": "2026-03-10T..." }
]
```

### Withdraw action

SUBMITTED → DRAFT: Faculty can withdraw **only if** the recommender hasn't acted yet (no RECOMMEND entry in verificationLog).

---

## 5. Dynamic Achievement Forms (Templates)

### Predefined templates in `shared.ts`

```ts
ACHIEVEMENT_TEMPLATES = {
  PUBLICATION: {
    label: "Research Publication",
    fields: [
      { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true },
      { key: "journalName", label: "Journal / Conference", type: "TEXT", required: true },
      { key: "issn", label: "ISSN / ISBN", type: "TEXT", required: false },
      { key: "volume", label: "Volume", type: "TEXT", required: false },
      { key: "issue", label: "Issue", type: "TEXT", required: false },
      { key: "doi", label: "DOI", type: "TEXT", required: false, placeholder: "10.xxxx/..." },
      { key: "indexing", label: "Indexing", type: "MULTI_SELECT", required: true,
        options: ["Scopus", "Web of Science", "UGC CARE List", "PubMed", "IEEE Xplore", "Other"] },
      { key: "publicationDate", label: "Publication Date", type: "DATE", required: true },
      { key: "pdfLink", label: "Paper PDF / URL", type: "URL", required: true },
      { key: "coAuthors", label: "Co-Authors", type: "TEXTAREA", required: false },
    ]
  },
  PATENT: {
    label: "Patent",
    fields: [
      { key: "patentTitle", label: "Patent Title", type: "TEXT", required: true },
      { key: "applicationNumber", label: "Application Number", type: "TEXT", required: true },
      { key: "patentOffice", label: "Patent Office", type: "SELECT", required: true,
        options: ["Indian Patent Office", "USPTO", "EPO", "WIPO", "Other"] },
      { key: "filingDate", label: "Filing Date", type: "DATE", required: true },
      { key: "status", label: "Status", type: "SELECT", required: true,
        options: ["Filed", "Published", "Granted", "Abandoned"] },
      { key: "grantDate", label: "Grant Date", type: "DATE", required: false },
      { key: "inventors", label: "Inventors", type: "TEXTAREA", required: true },
      { key: "certificateLink", label: "Certificate / Proof", type: "URL", required: false },
    ]
  },
  GRANT: {
    label: "Research Grant",
    fields: [
      { key: "projectTitle", label: "Project Title", type: "TEXT", required: true },
      { key: "fundingAgency", label: "Funding Agency", type: "TEXT", required: true },
      { key: "sanctionedAmount", label: "Sanctioned Amount", type: "NUMBER", required: true },
      { key: "duration", label: "Duration (months)", type: "NUMBER", required: false },
      { key: "startDate", label: "Start Date", type: "DATE", required: true },
      { key: "sanctionLetterLink", label: "Sanction Letter", type: "URL", required: true },
    ]
  },
  CONFERENCE: {
    label: "Conference Participation",
    fields: [
      { key: "conferenceName", label: "Conference Name", type: "TEXT", required: true },
      { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true },
      { key: "presentationType", label: "Presentation Type", type: "SELECT", required: true,
        options: ["Oral", "Poster", "Keynote", "Invited Talk", "Workshop"] },
      { key: "location", label: "Location", type: "TEXT", required: false },
      { key: "date", label: "Date", type: "DATE", required: true },
      { key: "proceedingsLink", label: "Proceedings / Certificate", type: "URL", required: false },
    ]
  },
  MOU: {
    label: "MoU / Collaboration",
    fields: [
      { key: "partnerOrg", label: "Partner Organization", type: "TEXT", required: true },
      { key: "scope", label: "Scope of MoU", type: "TEXTAREA", required: true },
      { key: "signedDate", label: "Signed Date", type: "DATE", required: true },
      { key: "validUntil", label: "Valid Until", type: "DATE", required: false },
      { key: "signedCopyLink", label: "Signed Copy", type: "URL", required: true },
    ]
  },
  TRAINING: {
    label: "Training / FDP",
    fields: [
      { key: "programName", label: "Program Name", type: "TEXT", required: true },
      { key: "organizer", label: "Organized By", type: "TEXT", required: true },
      { key: "role", label: "Role", type: "SELECT", required: true,
        options: ["Participant", "Resource Person", "Coordinator", "Organizer"] },
      { key: "startDate", label: "Start Date", type: "DATE", required: true },
      { key: "endDate", label: "End Date", type: "DATE", required: true },
      { key: "hours", label: "Duration (hours)", type: "NUMBER", required: false },
      { key: "certificateLink", label: "Certificate", type: "URL", required: true },
    ]
  },
  CERTIFICATION: {
    label: "Certification / Accreditation",
    fields: [
      { key: "certName", label: "Certification Name", type: "TEXT", required: true },
      { key: "issuingBody", label: "Issuing Body", type: "TEXT", required: true },
      { key: "validFrom", label: "Valid From", type: "DATE", required: true },
      { key: "validTo", label: "Valid To", type: "DATE", required: false },
      { key: "certificateLink", label: "Certificate", type: "URL", required: true },
    ]
  },
  GENERIC: {
    label: "General Achievement",
    fields: [
      { key: "description", label: "Description", type: "TEXTAREA", required: true },
      { key: "proofLink", label: "Supporting Document / Link", type: "URL", required: false },
    ]
  }
}
```

### Admin flow (KPI creation)

Admin creates KPI → selects template → fields auto-populate → can add/remove/customize → saved as `achievementFormConfig` on KpiDefinition.

### Faculty flow (achievement recording)

Faculty clicks "Record Achievement" → form renders dynamically from `achievementFormConfig`:
- Standard fields: actual value (per measurement type)
- Template fields: rendered dynamically from config
- All data saved as `achievementFormData` JSON on Achievement
- Zod validation runs against config at save time

### Zod schema for form config

```ts
const achievementFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().min(1).max(100),
  type: z.enum(["TEXT", "TEXTAREA", "NUMBER", "DATE", "URL", "EMAIL", "SELECT", "MULTI_SELECT", "BOOLEAN", "FILE_LINK"]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  pattern: z.string().optional(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

const achievementFormConfigSchema = z.object({
  templateKey: z.string().optional(),
  fields: z.array(achievementFieldSchema).min(1).max(30),
});
```

---

## 6. Cascade Rules for Dept Heads

**Allowed when ALL of**:
1. User is `isUnitHead` for the allocation's `assignedToUnitId`
2. `allocationType` is `INDIVIDUAL` or `BOTH`
3. Allocation `state` is `ACTIVE` (not LOCKED)

**Incremental cascade**: Allow adding more children to an already-cascaded parent. For NUMERIC/CURRENCY: existing children + new children must still sum to parent target.

**Cascade targets**:
- To **individual users** in the dept: via `getUnitMembers()` filtered to non-head members
- To **child OrgUnits**: via `OrgUnit WHERE parentId = unitId`
- For INDIVIDUAL type: only to users (not sub-units)

**Value rules**:
- NUMERIC/CURRENCY: child values must sum to parent `targetValue` (tolerance 0.01)
- All other types: value replicated to each child

---

## 7. Filters & Organization

### Quick status filters (with count badges)

| Filter | Meaning |
|---|---|
| All | Everything |
| Not Started | No achievement exists |
| In Progress | Achievement DRAFT |
| Pending Review | SUBMITTED or RECOMMENDED |
| Completed | VERIFIED |
| Not Approved | REJECTED (sent back) |
| Needs Cascade | Dept head: INDIVIDUAL/BOTH type not yet distributed |

### Source department filter

Dropdown of departments that originated KPIs allocated to this user. Derived from `kpiDefinition.startingUnit.name`. Useful for cross-functional KPIs.

### Category filter

Filter by KRA category (Research / Teaching / Community / etc.). Derived from `kraDefinition.category.displayLabel`.

### Weightage sort

- Highest weightage first (most important)
- Lowest weightage first (quick wins)
- Default: grouped by KRA

### Deadline filters

Data sources: `period.achievementDeadline`, `period.endDate`, review cycle dates.

| Filter | Rule |
|---|---|
| Overdue | Past `achievementDeadline` + no VERIFIED achievement |
| Due Soon | Within 14 days of deadline |
| Upcoming | >14 days away |

Display: "23 days left" / "5 days left" (amber) / "Overdue" (red) badge on each card.

### Review cycle display

For `reviewFrequency` != ANNUAL, compute sub-periods and show:
- "Current cycle: Q1 (ends Mar 31)"
- "Next deadline: 23 days"
- Filter: "Due this cycle"

---

## 8. Display Details

### Allocation card shows

- **Header**: KPI title + measurement type badge + weightage
- **Context**: KRA name + weightage, category badge
- **Source**: "From: Engineering Dept" (startingUnit)
- **Target**: Expected value with `unitLabel` (e.g., "Target: 15 publications")
- **Parent context**: If cascaded, show "Department target: 100 | Your share: 15 (15%)"
- **Deadline**: Days remaining badge
- **Status**: Achievement state indicator
- **Score**: If computed (color-coded: green ≥80, brand ≥60, amber ≥40, red <40)
- **Direction hint**: "Lower is better" for DESCENDING KPIs
- **isPerCapita**: "Per capita metric" label if true
- **Actions**: Record / Edit / Submit / Withdraw / View (context-dependent)
- **Expandable**: Guidance notes, description
- **Dept head children**: Expandable aggregate progress view

### Dept head aggregate progress view

```
Publications KPI (Target: 100)
├── Dr. Kumar: 15/15 ✅ Verified (Score: 100)
├── Dr. Sharma: 12/15 📝 Submitted
├── Dr. Patel: 0/15  ⬜ Not Started
│
│ Department Progress: 3 of 8 submitted, 1 verified
│ Aggregate: 42 of 100 achieved so far
```

### Achievement history trail (on each achievement)

```
Mar 5 — You submitted
Mar 7 — Dr. Singh (Dept Head) recommended: "Publications verified"
Mar 10 — Prof. Mehta (Source Dept) verified: "Approved"
```

---

## 9. State-Based UI Behavior

### Period states

| Period State | See | Record | Submit | Message |
|---|---|---|---|---|
| DRAFT | No | No | No | — |
| OPEN | Yes | No | No | "Targets are being set" |
| IN_PROGRESS | Yes | **Yes** | **Yes** | — |
| UNDER_REVIEW | Yes | **Yes** | **Yes** | "Period under review" |
| CLOSED | Yes (read-only) | No | No | "Period closed" (admin can still verify SUBMITTED/RECOMMENDED) |
| ARCHIVED | Yes (read-only) | No | No | "Period archived" |

### Achievement states → actions

| State | Assignee Can... |
|---|---|
| (none) | "Record Achievement" |
| DRAFT | Edit, Submit |
| SUBMITTED | View, **Withdraw** (if recommender hasn't acted) |
| RECOMMENDED | View only, "Pending final verification" |
| VERIFIED | View, score displayed, green badge |
| REJECTED | Edit and resubmit, reason shown (displayed as "Not Approved") |

---

## 10. Review Queue Tab

A **"Review Queue"** tab in My KPIs for unit heads. Shows items requiring their action.

### For dept heads (recommendation queue)

Query: Achievements WHERE `state = SUBMITTED` AND `targetAllocation.assignedToUnitId IN headOfUnits OR targetAllocation.assignedToUserId` is a member of their unit.

Actions: **Recommend** (with note) or **Send Back** (with reason).

### For source dept heads (verification queue)

Query: Achievements WHERE `state = RECOMMENDED` AND `kpiDefinition.startingUnitId IN headOfUnits`.

Actions: **Verify** (with note) or **Not Approve** (with reason).

### Display per review item

- Faculty name + designation
- KPI title + target vs actual
- Evidence / form data summary (expandable)
- Achievement trail so far
- Action buttons: Recommend/Verify | Send Back/Not Approve (with note input)

---

## 11. Files to Create & Modify

### New Files

| File | Purpose |
|---|---|
| `src/lib/kra-kpi/assignee-access.ts` | Permission helpers: canRecord, canCascade, mustCascade |
| `src/lib/kra-kpi/my-kpi-service.ts` | Queries: getMyKpiContext, getMyAllocations, getMyReviewQueue, getMyDashboardSummary, getMyUnitMembers, getMyChildUnits |
| `src/app/api/tenant/kra-kpi/my/context/route.ts` | GET — MyKpiContext for current user |
| `src/app/api/tenant/kra-kpi/my/allocations/route.ts` | GET — my allocations with filters |
| `src/app/api/tenant/kra-kpi/my/review-queue/route.ts` | GET — items pending recommendation/verification |
| `src/app/api/tenant/kra-kpi/my/dashboard/route.ts` | GET — personal summary |
| `src/app/api/tenant/kra-kpi/my/unit-members/route.ts` | GET — unit members for cascade |
| `src/app/api/tenant/kra-kpi/my/child-units/route.ts` | GET — child OrgUnits for cascade |
| `src/app/api/tenant/kra-kpi/my/cascade/route.ts` | POST — dept head cascade |
| `src/app/api/tenant/kra-kpi/my/recommend/route.ts` | POST — dept head recommend/send-back |
| `src/app/api/tenant/kra-kpi/my/withdraw/route.ts` | POST — faculty withdraw submission |
| `src/app/my-kpis/page.tsx` | Server component, requireTenantUser() |
| `src/app/my-kpis/my-kpi-hub.tsx` | Hub: My Targets, Review Queue, My Dashboard tabs |
| `src/components/my-kpis/my-allocation-card.tsx` | Allocation card with target, status, actions |
| `src/components/my-kpis/my-cascade-form.tsx` | Cascade form scoped to dept head's unit |
| `src/components/my-kpis/my-achievement-form.tsx` | Dynamic achievement form (renders from achievementFormConfig) |
| `src/components/my-kpis/my-review-item.tsx` | Review queue item with recommend/verify actions |
| `src/components/my-kpis/my-achievement-trail.tsx` | Timeline display of verification log |
| `src/components/my-kpis/my-dashboard.tsx` | Personal scores + progress |
| `src/components/my-kpis/dynamic-form-renderer.tsx` | Renders form fields dynamically from achievementFormConfig |

### Modified Files

| File | Changes |
|---|---|
| `prisma/schema.prisma` | RECOMMENDED state, achievement fields, KPI template fields, Notification model |
| `src/lib/kra-kpi/shared.ts` | ACHIEVEMENT_TEMPLATES, Zod schemas for form config/data, updated state transitions |
| `src/lib/kra-kpi/achievement-service.ts` | RECOMMENDED state handling, withdraw, form data validation, duplicate prevention, verification log |
| `src/lib/kra-kpi/target-service.ts` | Extract cascade internals, allow head-of-unit callers, incremental cascade |
| `src/lib/kra-kpi/kpi-service.ts` | Accept achievementTemplateKey + achievementFormConfig on create/update |
| `src/lib/navigation.ts` | Add "My KPIs" to navigation groups |
| `src/components/tenant/kra-kpi/kpi-definition-form.tsx` | Add template picker + custom field editor section |
| `src/components/tenant/kra-kpi/achievement-review-list.tsx` | Handle RECOMMENDED state, show verification log |

---

## 12. Build Order — R1.1a

| Step | What | Depends On |
|---|---|---|
| 1 | Schema migration: RECOMMENDED state, template fields, Notification model | — |
| 2 | `shared.ts`: ACHIEVEMENT_TEMPLATES, Zod schemas, updated transitions | Step 1 |
| 3 | `assignee-access.ts`: permission helpers | — |
| 4 | `my-kpi-service.ts`: context, allocations, review queue, dashboard | Steps 2, 3 |
| 5 | Modify `achievement-service.ts`: RECOMMENDED flow, withdraw, form data, verification log, duplicate prevention | Steps 1, 2 |
| 6 | Modify `target-service.ts`: extract cascade internals, head-of-unit cascade, incremental | — |
| 7 | Modify `kpi-service.ts`: template + form config support | Step 2 |
| 8 | API routes: `/my/context`, `/my/allocations`, `/my/dashboard` | Step 4 |
| 9 | API routes: `/my/review-queue`, `/my/recommend`, `/my/withdraw` | Steps 4, 5 |
| 10 | API routes: `/my/unit-members`, `/my/child-units`, `/my/cascade` | Steps 4, 6 |
| 11 | Modify `kpi-definition-form.tsx`: template picker + field editor | Step 7 |
| 12 | Navigation update | — |
| 13 | `my-kpis/page.tsx` + `my-kpi-hub.tsx` (shell with tabs + filters) | Step 12 |
| 14 | `dynamic-form-renderer.tsx` | Step 2 |
| 15 | `my-allocation-card.tsx` | Step 8 |
| 16 | `my-achievement-form.tsx` (uses dynamic renderer) | Steps 8, 14 |
| 17 | `my-cascade-form.tsx` | Step 10 |
| 18 | `my-review-item.tsx` + `my-achievement-trail.tsx` | Step 9 |
| 19 | `my-dashboard.tsx` | Step 8 |
| 20 | Nav badge count (pending actions) | Step 8 |

---

## 13. Edge Cases

1. **User is head AND has individual assignments** — Both appear, grouped separately
2. **BOTH type already cascaded** — `childCount > 0` → disable "Record at dept level"
3. **No allocations** — Empty state message
4. **Assignee's unit === startingUnit** — Skip RECOMMENDED, go SUBMITTED → VERIFIED directly
5. **Achievement already exists for allocation** — Block new creation, link to existing
6. **SUBMITTED then period closes** — Admin can still verify in CLOSED state
7. **Withdraw after recommender acted** — Block (verificationLog has RECOMMEND entry)
8. **Incremental cascade sum** — Existing + new children must still sum to parent for NUMERIC/CURRENCY
9. **Target value null** — Show "Target not set yet", disable recording
10. **KPI with 0 weightage or DRAFT state** — Hide from assignee view
11. **User transferred mid-period** — Old allocations remain (tied to userId/unitId)
12. **Target updated after achievement submitted** — Show warning "Target was updated"
13. **Faculty in multiple departments** — Show allocations from all units, grouped by unit
14. **Same KPI cascaded from two parents** — Each is a separate allocation, show both with source context

---

## 14. R1.1a Verification

1. Admin creates KPI with PUBLICATION template → form config saved
2. Admin allocates to dept → dept head sees it in My KPIs
3. DEPARTMENT type → dept head records with dynamic form (ISSN, DOI, etc.), submits
4. INDIVIDUAL type → "Must Distribute" banner → cascade to 3 faculty → each sees their allocation
5. BOTH type → choice UI → cascade creates children → recording disabled at parent
6. Faculty records achievement with template fields → saves as JSON → submits
7. Faculty withdraws submission (before recommendation) → back to DRAFT
8. Dept head sees SUBMITTED in Review Queue → recommends with note
9. Source dept head sees RECOMMENDED in Review Queue → verifies → score computed
10. Source dept head not-approves → back to DRAFT with reason → faculty sees "Not Approved"
11. Shortcut: same-dept KPI → skips RECOMMENDED step
12. Filters: source dept, category, status, weightage sort, deadline → all work
13. Review cycle deadlines shown for non-ANNUAL frequencies
14. Duplicate achievement blocked
15. Period CLOSED → read-only, but verification of pending items still works
16. Nav badge shows pending count
17. `npm run build` passes

---

# ═══════════════════════════════════════════════════════════════════════════════
# R1.1b — Engagement & Discovery
# ═══════════════════════════════════════════════════════════════════════════════

Built after R1.1a is complete and tested.

## 1. Additional Achievements Tab

New tab in My KPIs: **"Additional Achievements"**

- User browses/searches ALL active KPIs in the tenant (grouped by KRA/category)
- Selects a KPI → records achievement WITHOUT a `targetAllocationId`
- Goes through same recommend → verify flow
- **Block if** user already has an allocated target for that KPI (use allocated flow instead)
- **Scoring**: If KPI has `defaultTarget`, compute score. Otherwise score = null (verifier assesses manually)
- Displayed separately in dashboard: "Allocated KPIs" vs "Additional Contributions"

### API

| Route | Method | Purpose |
|---|---|---|
| `/my/available-kpis` | GET | All active KPIs the user can submit additional achievements for |
| `/my/additional-achievements` | GET, POST | List/create unallocated achievements |

## 2. Notification System

### Event triggers (created in service layer)

| Event | Recipient | Message |
|---|---|---|
| KPI allocated to dept/user | Dept head / User | "Publications KPI allocated. Target: 15" |
| Achievement submitted | Dept head | "Dr. Kumar submitted Publications achievement" |
| Achievement recommended | Source dept head | "CS Dept recommended Dr. Kumar's achievement" |
| Achievement verified | Faculty | "Publications achievement verified. Score: 85" |
| Achievement not approved | Faculty | "Publications was not approved. Reason: ..." |
| Achievement sent back by recommender | Faculty | "Dept head returned your Publications submission" |
| Target value updated | Assignee | "Publications target updated to 20" |
| Period state changed | All with allocations | "AY 2025-26 is now In Progress" |
| Cascade received | Individual | "You've been assigned Publications KPI. Target: 3" |

### UI

- Bell icon in AppShell header with unread count badge
- Dropdown: recent notifications (latest 20)
- Click → navigates to relevant item
- "Mark all as read" action
- Full notification page (optional, linked from dropdown)

### API

| Route | Method | Purpose |
|---|---|---|
| `/api/tenant/notifications` | GET | List notifications for current user |
| `/api/tenant/notifications/mark-read` | POST | Mark one or all as read |
| `/api/tenant/notifications/count` | GET | Unread count (for badge) |

### Service

New `src/lib/notifications/notification-service.ts`:
- `createNotification(tenantId, userId, type, title, message, entityType?, entityId?, linkUrl?)`
- `listNotifications(tenantId, userId, limit, offset)`
- `markRead(notificationId)`, `markAllRead(tenantId, userId)`
- `getUnreadCount(tenantId, userId)`

## 3. Workspace Dashboard Bubble

On the existing workspace/dashboard page, add a KRA/KPI summary card:

```
┌─────────────────────────────────┐
│  My KRA/KPI Summary             │
│                                 │
│  12 Allocated  │  3 Completed   │
│   2 Pending    │  1 Not Approved│
│                                 │
│  Overall Score: 72%  ████████░░ │
│                                 │
│  [View My KPIs →]               │
└─────────────────────────────────┘
```

API: Reuse `/my/dashboard` endpoint from R1.1a.

## 4. Bulk Submit All Drafts

"Submit All Drafts" button on My Targets tab. Submits all DRAFT achievements at once.

API: `POST /my/bulk-submit` — body: `{ achievementIds: string[] }`

## 5. Category Quick-Access Tabs

Top-level filter tabs on My Targets: **All | Research | Teaching | Community | ...**
Derived from KRA categories. Clicking filters the allocation list by category.

---

## R1.1b Build Order

| Step | What | Depends On |
|---|---|---|
| 1 | `notification-service.ts` | Notification model (from R1.1a schema) |
| 2 | Notification API routes | Step 1 |
| 3 | Bell icon + dropdown UI in AppShell | Step 2 |
| 4 | Wire notification triggers into achievement-service, target-service, period-service | Step 1 |
| 5 | Additional achievements: API routes | — |
| 6 | Additional achievements: search UI + form | Steps 5, R1.1a dynamic form |
| 7 | Workspace dashboard bubble component | R1.1a dashboard API |
| 8 | Bulk submit API + button | — |
| 9 | Category quick-access tabs | — |

## R1.1b Verification

1. Submit achievement → dept head gets notification → recommend → source head gets notification → verify → faculty gets notification
2. Bell icon shows unread count, clicking opens dropdown, clicking item navigates to relevant page
3. Additional achievement: faculty searches "Publications" KPI, submits without allocation, goes through verification
4. Block additional if user already has allocated target for that KPI
5. Workspace dashboard bubble shows correct counts + score
6. Bulk submit: 5 drafts submitted at once → all become SUBMITTED
7. Category tabs filter correctly
8. `npm run build` passes

---

# Summary

| Release | What | Key Deliverables |
|---|---|---|
| **R1.1a** | Core assignee experience | My KPIs page, dynamic forms, 2-level verification, filters, cascade, review queue, withdraw |
| **R1.1b** | Engagement & discovery | Notifications, additional achievements, dashboard bubble, bulk submit, category tabs |
| **R1.2** (future) | Acting assignments, print/export, delegation |
| **R2** | Full 4-dept workflow, stages, file uploads, reverse-route chain |
| **R3** | Accreditation mapping, rewards, contributor roles, industry template packs |

---

# ═══════════════════════════════════════════════════════════════════════════════
# TEST PLANS
# ═══════════════════════════════════════════════════════════════════════════════

## Test Setup (Prerequisites)

Before testing, ensure the following data exists:

**Org Structure**:
- Tenant with active structure version
- School of Engineering (level 1) — Dean is unit head
- CS Department (level 2, child of School) — HOD is unit head
- ME Department (level 2, child of School) — HOD is unit head
- 3-4 faculty members assigned to CS Dept (non-head roles)
- 1-2 faculty members assigned to ME Dept

**KRA/KPI Setup**:
- Period "AY 2025-26" in IN_PROGRESS state, reviewFrequency = QUARTERLY, achievementDeadline set
- KRA "Research" (weightage: 40) with category "Research"
  - KPI "Publications" (weightage: 20, allocationType: INDIVIDUAL, template: PUBLICATION, startingUnit: School)
  - KPI "Patents" (weightage: 10, allocationType: BOTH, template: PATENT, startingUnit: School)
  - KPI "Grants" (weightage: 10, allocationType: DEPARTMENT, template: GRANT, startingUnit: School)
- KRA "Teaching" (weightage: 30) with category "Teaching"
  - KPI "Student Feedback" (weightage: 15, allocationType: DEPARTMENT, template: GENERIC, startingUnit: CS Dept)
  - KPI "Pass Rate" (weightage: 15, allocationType: INDIVIDUAL, template: GENERIC, startingUnit: CS Dept)
- KRA "Community" (weightage: 30) with category "Community"
  - KPI "MoUs" (weightage: 30, allocationType: BOTH, template: MOU, startingUnit: School)

**Target Allocations**:
- Publications → allocated to CS Dept (target: 50 papers)
- Patents → allocated to CS Dept (target: 5)
- Grants → allocated to CS Dept (target: ₹20,00,000)
- Student Feedback → allocated to CS Dept (target: 4.0 rating)
- Pass Rate → allocated to CS Dept (target: 85%)
- MoUs → allocated to CS Dept (target: 3)

---

# R1.1a Test Plan

## T1. Schema & Migration

| # | Test | Steps | Expected |
|---|---|---|---|
| T1.1 | Migration runs clean | `npx prisma migrate dev` | No errors, RECOMMENDED state added, new fields on KpiDefinition + Achievement, Notification model created |
| T1.2 | Prisma client generates | `npx prisma generate` | No errors, types include RECOMMENDED, achievementFormConfig, etc. |
| T1.3 | Existing data intact | Query existing R1 data | All KRAs, KPIs, allocations, achievements from R1 still present and correct |

## T2. Achievement Templates (Admin Side)

| # | Test | Steps | Expected |
|---|---|---|---|
| T2.1 | Template picker on KPI form | Admin edits Publications KPI, sees template dropdown | Dropdown shows: Publication, Patent, Grant, Conference, MoU, Training, Certification, Generic |
| T2.2 | Template selection populates fields | Admin selects "Publication" template | Form shows field list: Paper Title, Journal Name, ISSN, Volume, Issue, DOI, Indexing, Publication Date, PDF Link, Co-Authors |
| T2.3 | Custom field addition | Admin adds a custom field "Impact Factor" (NUMBER, required) | Field appears in the list, saved to achievementFormConfig |
| T2.4 | Field removal | Admin removes optional "Volume" field | Field removed from config, saved |
| T2.5 | Config persisted | Reload KPI edit form | Previously saved template + customizations still present |
| T2.6 | No template selected | Admin creates KPI without selecting template | achievementFormConfig is null, achievement uses generic form (description + links) |

## T3. My KPIs Page — Navigation & Access

| # | Test | Steps | Expected |
|---|---|---|---|
| T3.1 | TENANT_USER sees nav item | Login as faculty (TENANT_USER role) | "My KPIs" appears in sidebar navigation |
| T3.2 | TENANT_ADMIN sees nav item | Login as admin | "My KPIs" appears alongside "KRA / KPI" admin link |
| T3.3 | Page loads | Navigate to /my-kpis | Page loads with tabs: My Targets, Review Queue, My Dashboard |
| T3.4 | Unauthenticated redirect | Access /my-kpis without login | Redirected to /login |
| T3.5 | Nav badge shows count | Faculty has 2 pending items | Badge shows "2" on My KPIs nav item |

## T4. My Targets Tab — Allocation Visibility

| # | Test | Steps | Expected |
|---|---|---|---|
| T4.1 | Dept head sees dept allocations | Login as CS HOD, select period AY 2025-26 | Sees all 6 KPIs allocated to CS Dept, grouped by KRA |
| T4.2 | Faculty sees nothing initially | Login as faculty (no individual allocations yet) | Empty state: "No KPIs have been allocated to you..." |
| T4.3 | Faculty sees individual allocations | HOD cascades Publications to faculty → login as faculty | Faculty sees their individual Publications allocation |
| T4.4 | Head with dual role | HOD also has individual allocation → login as HOD | Sees both "Department KPIs" and "My Individual KPIs" sections |
| T4.5 | Multi-dept faculty | Faculty assigned to CS + ME depts → both have allocations | Sees allocations from both, grouped by department |
| T4.6 | Period selector | Switch between periods | Allocations update to show selected period's data |
| T4.7 | DRAFT period hidden | Period in DRAFT state | Does not appear in period dropdown |
| T4.8 | CLOSED period read-only | Select a CLOSED period | Allocations shown, all action buttons disabled, "Period closed" message |

## T5. Allocation Card Display

| # | Test | Steps | Expected |
|---|---|---|---|
| T5.1 | Card shows KPI details | View Publications allocation card | Shows: title, measurement type badge (NUMERIC), weightage (20), unit label |
| T5.2 | KRA context | View card | Shows "KRA: Research (weightage: 40)" |
| T5.3 | Source department | View card | Shows "From: School of Engineering" |
| T5.4 | Target value | View card | Shows "Target: 50 publications" |
| T5.5 | Parent target context | Faculty with cascaded allocation (target: 8) | Shows "Department target: 50 \| Your share: 8 (16%)" |
| T5.6 | Deadline badge | achievementDeadline is 20 days away | Shows "20 days left" badge |
| T5.7 | Overdue badge | achievementDeadline has passed | Shows "Overdue" red badge |
| T5.8 | DESCENDING direction hint | KPI with scoringDirection: DESCENDING | Shows "Lower is better" label |
| T5.9 | isPerCapita label | KPI with isPerCapita: true | Shows "Per capita metric" label |
| T5.10 | Guidance notes | KPI has guidanceNotes | Expandable section shows notes |

## T6. Allocation Types & Actions

| # | Test | Steps | Expected |
|---|---|---|---|
| T6.1 | DEPARTMENT — head can record | Grants KPI (DEPARTMENT type), login as HOD | "Record Achievement" button visible and enabled |
| T6.2 | DEPARTMENT — no cascade | Grants KPI | No cascade/distribute button shown |
| T6.3 | INDIVIDUAL — must cascade | Publications KPI (INDIVIDUAL type), login as HOD | Amber "Must Distribute" banner, "Distribute" button shown, "Record" disabled |
| T6.4 | INDIVIDUAL — head cannot record | Publications KPI, HOD tries to record | Recording blocked, message: "Must be distributed first" |
| T6.5 | BOTH — choice UI | Patents KPI (BOTH type), login as HOD, no children | Shows two buttons: "Record at dept level" / "Distribute to individuals" |
| T6.6 | BOTH — after cascade | HOD cascades Patents to faculty | "Record at dept level" disappears, children shown below |
| T6.7 | Individual allocation — user records | Faculty with cascaded Publications allocation | "Record Achievement" button visible and enabled |
| T6.8 | Wrong user cannot record | Faculty A tries to access Faculty B's allocation | Recording blocked |

## T7. Cascade (Dept Head)

| # | Test | Steps | Expected |
|---|---|---|---|
| T7.1 | Cascade to individuals | HOD cascades Publications (target: 50) to 5 faculty | Cascade form shows unit members, requires values summing to 50 |
| T7.2 | Sum validation — NUMERIC | Enter values summing to 48 | Error: "Values must sum to 50" |
| T7.3 | Sum validation — pass | Enter values summing to 50 | Cascade succeeds, 5 child allocations created |
| T7.4 | Non-summable type replicate | Patents (BOOLEAN) cascaded | Each child gets same target value as parent |
| T7.5 | Incremental cascade | HOD cascades to 3 faculty, then adds 2 more | Second cascade succeeds, total 5 children, sum still matches parent |
| T7.6 | LOCKED allocation cannot cascade | Admin locks allocation → HOD tries cascade | Cascade blocked: "Target is locked" |
| T7.7 | Non-head cannot cascade | Regular faculty tries to cascade | API returns 403 |
| T7.8 | DEPARTMENT type cannot cascade | Grants KPI (DEPARTMENT) → HOD tries | No cascade option shown / API rejects |
| T7.9 | Child units cascade | Dean cascades School-level KPI to CS Dept + ME Dept | Two unit-level child allocations created |

## T8. Dynamic Achievement Form

| # | Test | Steps | Expected |
|---|---|---|---|
| T8.1 | PUBLICATION form renders | Faculty clicks "Record" on Publications KPI | Form shows: Actual Count (standard) + Paper Title, Journal Name, ISSN, Volume, Issue, DOI, Indexing (multi-select), Publication Date, PDF Link, Co-Authors |
| T8.2 | Required field validation | Submit without required "Journal Name" | Validation error on Journal Name field |
| T8.3 | Multi-select works | Select Scopus + Web of Science for Indexing | Both values saved |
| T8.4 | Date picker works | Select publication date | Date saved correctly |
| T8.5 | URL validation | Enter invalid URL for PDF Link | Validation error |
| T8.6 | Save as draft | Fill fields, click "Save Draft" | Achievement created as DRAFT, form data saved as JSON |
| T8.7 | Edit draft | Reopen draft achievement | All previously saved fields populated correctly |
| T8.8 | PATENT form renders | Record achievement for Patents KPI | Shows Patent-specific fields: Title, Application Number, Patent Office (select), Filing Date, etc. |
| T8.9 | GENERIC form (no template) | KPI without template | Shows only: Description (textarea) + Proof Link (URL) |
| T8.10 | Custom field appears | Admin added "Impact Factor" field | Field appears in form, validation works |
| T8.11 | Form data persisted | Query Achievement.achievementFormData | JSON contains all field values matching the schema |

## T9. 2-Level Verification Flow

| # | Test | Steps | Expected |
|---|---|---|---|
| T9.1 | Faculty submits | Faculty submits DRAFT achievement | State → SUBMITTED, verificationLog entry added |
| T9.2 | Dept head sees in review queue | Login as CS HOD → Review Queue tab | SUBMITTED achievement appears with faculty name, KPI, actual value |
| T9.3 | Dept head recommends | HOD clicks "Recommend" with note "Verified" | State → RECOMMENDED, recommendedByUserId set, verificationLog entry added |
| T9.4 | Dept head sends back | HOD clicks "Send Back" with reason | State → DRAFT, reason shown to faculty |
| T9.5 | Source head sees recommended | Login as Dean (School head) → Review Queue | RECOMMENDED achievement appears |
| T9.6 | Source head verifies | Dean clicks "Verify" with note | State → VERIFIED, score computed, verifiedByUserId + verifiedAt set |
| T9.7 | Source head not-approves | Dean clicks "Not Approve" with reason | State → DRAFT (displayed as "Not Approved"), reason shown to faculty |
| T9.8 | Shortcut — same dept | Student Feedback KPI (startingUnit: CS Dept), CS HOD is both recommender + verifier | SUBMITTED → VERIFIED directly (no RECOMMENDED step) |
| T9.9 | Faculty re-submits after not-approved | Faculty edits + re-submits | State → SUBMITTED again, new verificationLog entries appended |
| T9.10 | Verification trail display | View achievement with full trail | Timeline shows: Submitted → Recommended → Verified with names, notes, timestamps |

## T10. Withdraw

| # | Test | Steps | Expected |
|---|---|---|---|
| T10.1 | Withdraw before recommendation | Faculty submits, then clicks "Withdraw" | State → DRAFT, can edit again |
| T10.2 | Withdraw blocked after recommendation | Achievement is RECOMMENDED → faculty tries withdraw | Withdraw button not shown / API returns error |
| T10.3 | Withdraw blocked for VERIFIED | Achievement VERIFIED | Withdraw not available |

## T11. Duplicate Prevention

| # | Test | Steps | Expected |
|---|---|---|---|
| T11.1 | Block duplicate for same allocation | Faculty has DRAFT achievement for Publications → tries to create another | Error: "Achievement already exists. Edit the existing one." with link |
| T11.2 | Block duplicate — SUBMITTED | Existing SUBMITTED achievement → create new | Blocked |
| T11.3 | Allow after VERIFIED | Existing VERIFIED achievement → create new for next review cycle | Allowed (different reporting period) |

## T12. Filters

| # | Test | Steps | Expected |
|---|---|---|---|
| T12.1 | Status filter — Not Started | Click "Not Started" | Shows only allocations with no achievement |
| T12.2 | Status filter — In Progress | Click "In Progress" | Shows only allocations with DRAFT achievement |
| T12.3 | Status filter — Pending Review | Click "Pending Review" | Shows SUBMITTED + RECOMMENDED |
| T12.4 | Status filter — Completed | Click "Completed" | Shows only VERIFIED |
| T12.5 | Status filter — Not Approved | Click "Not Approved" | Shows only REJECTED |
| T12.6 | Status filter — Needs Cascade | Click "Needs Cascade" (HOD only) | Shows INDIVIDUAL/BOTH with no children |
| T12.7 | Source dept filter | Select "School of Engineering" | Shows only KPIs where startingUnit = School |
| T12.8 | Category filter | Select "Research" | Shows only KPIs under Research KRA category |
| T12.9 | Weightage sort — highest | Sort by "Highest weightage" | KPIs ordered by weightage descending |
| T12.10 | Deadline filter — Due Soon | Click "Due Soon" | Shows allocations within 14 days of deadline |
| T12.11 | Deadline filter — Overdue | Click "Overdue" | Shows past-deadline without VERIFIED achievement |
| T12.12 | Filter counts | View filter badges | Each filter shows correct count |
| T12.13 | Combined filters | Source: School + Status: Not Started | Shows intersection |

## T13. Review Cycle Display

| # | Test | Steps | Expected |
|---|---|---|---|
| T13.1 | Quarterly cycle shown | Period with QUARTERLY frequency | Shows "Current cycle: Q1 (Jan 1 – Mar 31)" |
| T13.2 | Cycle deadline | Review deadline set for Q1 | Shows deadline countdown |
| T13.3 | Annual — no sub-periods | Period with ANNUAL frequency | No cycle display, just period dates |

## T14. Dashboard Tab

| # | Test | Steps | Expected |
|---|---|---|---|
| T14.1 | Overall score | 3 of 6 KPIs verified with scores 80, 90, 70 | Weighted score computed correctly |
| T14.2 | Progress bar | 4 of 6 KPIs have achievements | Shows "4 of 6 KPIs" |
| T14.3 | Status breakdown | 1 not started, 1 draft, 1 submitted, 1 recommended, 2 verified | Correct counts for each |
| T14.4 | KRA breakdown | Research: 60%, Teaching: 80% | Per-KRA score shown |
| T14.5 | Empty period | Period with no allocations | Dashboard shows zeros/empty state |

## T15. Dept Head Progress View

| # | Test | Steps | Expected |
|---|---|---|---|
| T15.1 | Children status list | HOD expands cascaded Publications KPI | Shows each faculty with target, actual, status, score |
| T15.2 | Aggregate progress | 3 of 5 faculty submitted | Shows "3 of 5 submitted" |
| T15.3 | Aggregate value | Faculty actuals: 8, 12, 5, 0, 0 | Shows "25 of 50 achieved" |

## T16. Edge Cases

| # | Test | Steps | Expected |
|---|---|---|---|
| T16.1 | Target value null | Allocation with no target set | "Target not set yet", recording disabled |
| T16.2 | KPI DRAFT state | KPI in DRAFT (not ACTIVE) | Not shown to assignees |
| T16.3 | KPI 0 weightage | KPI with weightage 0 | Not shown to assignees |
| T16.4 | Period OPEN — no recording | Period in OPEN state | Allocations shown, "Record" disabled, message displayed |
| T16.5 | CLOSED period + pending items | Period closes with SUBMITTED achievements | Admin/source head can still verify |
| T16.6 | Target updated after submission | Admin changes target after faculty submitted | Warning shown: "Target was updated after your submission" |
| T16.7 | Same KPI from two parents | KPI cascaded to user from two different parent allocations | Both appear as separate cards with source context |

## T17. Build Verification

| # | Test | Steps | Expected |
|---|---|---|---|
| T17.1 | Build passes | `npm run build` | No TypeScript errors, no build failures |
| T17.2 | No R1 regressions | Admin hub still works: create period, KRA, KPI, allocate, verify | All R1 functionality intact |
| T17.3 | Lint passes | `npm run lint` (if configured) | No new lint errors |

---

# R1.1b Test Plan

## T18. Notification System

| # | Test | Steps | Expected |
|---|---|---|---|
| T18.1 | Bell icon visible | Login as any user | Bell icon in AppShell header |
| T18.2 | Unread count badge | User has 3 unread notifications | Badge shows "3" |
| T18.3 | Zero unread | No notifications | No badge shown |
| T18.4 | Dropdown opens | Click bell icon | Dropdown shows latest 20 notifications |
| T18.5 | Notification on allocation | Admin allocates KPI to CS Dept | CS HOD receives notification: "Publications KPI allocated. Target: 50" |
| T18.6 | Notification on cascade | HOD cascades to faculty | Each faculty receives: "You've been assigned Publications KPI. Target: 8" |
| T18.7 | Notification on submit | Faculty submits achievement | HOD receives: "Dr. Kumar submitted Publications achievement" |
| T18.8 | Notification on recommend | HOD recommends | Dean receives: "CS Dept recommended Dr. Kumar's achievement" |
| T18.9 | Notification on verify | Dean verifies | Faculty receives: "Publications achievement verified. Score: 85" |
| T18.10 | Notification on not-approve | Dean not-approves | Faculty receives: "Publications was not approved. Reason: ..." |
| T18.11 | Notification on send-back | HOD sends back | Faculty receives: "Dept head returned your Publications submission" |
| T18.12 | Notification on target update | Admin updates target value | Assignee receives: "Publications target updated to 20" |
| T18.13 | Notification on period transition | Admin moves period to IN_PROGRESS | All users with allocations receive notification |
| T18.14 | Click navigates | Click notification about verified achievement | Navigates to My KPIs → that achievement |
| T18.15 | Mark as read | Click "Mark as read" on single notification | Unread count decrements, notification appears read |
| T18.16 | Mark all read | Click "Mark all as read" | All notifications marked read, badge disappears |

## T19. Additional Achievements

| # | Test | Steps | Expected |
|---|---|---|---|
| T19.1 | Tab visible | Login as faculty → My KPIs | "Additional Achievements" tab appears |
| T19.2 | Search all KPIs | Open tab, search "Publications" | Shows Publications KPI from all KRAs/categories |
| T19.3 | Browse by category | Filter by "Research" category | Shows only Research KPIs |
| T19.4 | Record unallocated achievement | Select Publications KPI (not allocated to this user), fill form | Achievement created with targetAllocationId = null |
| T19.5 | Dynamic form renders | Select KPI with PUBLICATION template | Publication-specific form fields shown |
| T19.6 | Block if already allocated | User has allocated Publications target → tries additional | Error: "You already have an allocated target for this KPI. Use the allocated flow." |
| T19.7 | Scoring with defaultTarget | KPI has defaultTarget: 10, user enters actual: 8 | Score computed: 80 |
| T19.8 | Scoring without defaultTarget | KPI has no defaultTarget | Score = null, note: "Score will be assessed by verifier" |
| T19.9 | Verification flow | Submit additional achievement | Goes through same 2-level verification (recommend → verify) |
| T19.10 | Dashboard separation | View dashboard | "Allocated KPIs" and "Additional Contributions" shown separately |

## T20. Workspace Dashboard Bubble

| # | Test | Steps | Expected |
|---|---|---|---|
| T20.1 | Bubble visible | Login → workspace/dashboard page | KRA/KPI summary card visible |
| T20.2 | Counts correct | 12 allocated, 3 completed, 2 pending, 1 not approved | Card shows correct numbers |
| T20.3 | Score bar | Overall score: 72% | Progress bar filled to 72% |
| T20.4 | Link works | Click "View My KPIs →" | Navigates to /my-kpis |
| T20.5 | No allocations | User with no KPI allocations | Card shows "No KPIs allocated" or is hidden |

## T21. Bulk Submit

| # | Test | Steps | Expected |
|---|---|---|---|
| T21.1 | Button visible | User has 5 DRAFT achievements | "Submit All Drafts (5)" button shown |
| T21.2 | Bulk submit works | Click "Submit All Drafts" | All 5 become SUBMITTED, verificationLog entry on each |
| T21.3 | No drafts | User has 0 DRAFT achievements | Button hidden or disabled |
| T21.4 | Partial drafts | 3 DRAFT, 2 SUBMITTED | Button shows "Submit All Drafts (3)", submits only the 3 |

## T22. Category Quick-Access Tabs

| # | Test | Steps | Expected |
|---|---|---|---|
| T22.1 | Tabs render | Categories: Research, Teaching, Community exist | Tabs: All \| Research \| Teaching \| Community |
| T22.2 | Filter by category | Click "Research" | Shows only KPIs under Research KRA category |
| T22.3 | "All" tab | Click "All" | Shows all allocations |
| T22.4 | Counts on tabs | Research: 3 KPIs, Teaching: 2 | Tab labels show counts |
| T22.5 | Combined with other filters | Category: Research + Status: Not Started | Shows intersection |

## T23. R1.1b Build & Regression

| # | Test | Steps | Expected |
|---|---|---|---|
| T23.1 | Build passes | `npm run build` | No errors |
| T23.2 | R1.1a features intact | All T1–T17 tests still pass | No regressions |
| T23.3 | R1 admin features intact | Admin hub fully functional | No regressions |

---

# End-to-End Scenario Tests (After R1.1a + R1.1b)

## E2E-1: Full Faculty Lifecycle

```
1. Admin creates period (AY 2025-26) → transitions to OPEN
2. Admin creates KRA "Research" (40) + KPI "Publications" (20, INDIVIDUAL, PUBLICATION template)
3. Admin allocates Publications to CS Dept (target: 50)
4. Admin transitions period to IN_PROGRESS
   → CS HOD receives notification
5. CS HOD logs in → My KPIs → sees Publications with "Must Distribute"
6. HOD cascades to 5 faculty (10 each)
   → Each faculty receives notification
7. Dr. Kumar logs in → My KPIs → sees Publications (target: 10, dept target: 50)
8. Dr. Kumar clicks "Record Achievement"
   → Dynamic form: Paper Title, Journal, ISSN, DOI, Indexing, Date, PDF Link
9. Dr. Kumar fills form (actual: 12), saves as Draft
10. Dr. Kumar edits draft, submits
    → HOD receives notification
11. HOD → Review Queue → sees submission → recommends: "Verified all papers"
    → Dean receives notification
12. Dean → Review Queue → sees recommended → verifies: "Approved"
    → Dr. Kumar receives notification: "Verified. Score: 100"
13. Dr. Kumar → My Dashboard → sees score for Publications
14. Dr. Kumar also published an MoU (not allocated to him)
    → Additional Achievements → searches "MoU" → records with MOU template → submits
15. Workspace dashboard bubble shows: 1 Completed, 1 Pending
```

## E2E-2: Rejection & Re-submission

```
1. Faculty submits Publications achievement with actual: 3
2. HOD sends back: "Please attach proof PDFs"
   → Faculty receives notification
3. Faculty sees "Not Approved" status with reason
4. Faculty edits: adds PDF links, re-submits
5. HOD recommends
6. Dean not-approves: "Indexing not verified"
   → Faculty receives notification
7. Faculty edits: updates indexing info, re-submits
8. HOD recommends again
9. Dean verifies
   → Full trail shows all 7 steps
```

## E2E-3: Department Head with Mixed Types

```
1. CS HOD logs in, sees 6 KPIs:
   - Publications (INDIVIDUAL) → "Must Distribute"
   - Patents (BOTH) → "Record / Distribute" choice
   - Grants (DEPARTMENT) → "Record Achievement"
   - Student Feedback (DEPARTMENT) → "Record Achievement"
   - Pass Rate (INDIVIDUAL) → "Must Distribute"
   - MoUs (BOTH) → "Record / Distribute" choice
2. HOD cascades Publications to faculty
3. HOD keeps Patents at dept level → records achievement
4. HOD records Grants achievement with GRANT template
5. HOD cascades Pass Rate to faculty
6. HOD distributes MoUs to faculty
7. Dashboard shows: 2 dept-level recorded, 3 cascaded (awaiting faculty), 1 not started
```
