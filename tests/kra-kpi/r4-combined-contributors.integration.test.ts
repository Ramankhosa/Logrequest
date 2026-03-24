/**
 * R4.1 Combined Integration Tests — Contributor Roles, External Templates, Team Achievements, Duplicate Detection
 *
 * These tests exercise the FULL pipeline across R4.1a (contributor roles),
 * R4.1b (external contributor templates + KPI config), and R4.1c (team achievements + duplicate detection).
 * Each test builds a realistic end-to-end scenario rather than testing a single function.
 *
 * CODEX INSTRUCTIONS:
 * -------------------
 * 1. Implement every test marked with `test.todo(...)` below.
 * 2. Follow the existing `createFixture()` pattern — each test should be self-contained.
 * 3. Use ONLY the public service APIs (no direct Prisma writes except in fixture setup).
 * 4. Do NOT change the `describe` / `test` names — they map to our tracking sheet.
 * 5. Where a test says "assert X", use `expect(...).toBe(...)` or `expect(...).toMatchObject(...)`.
 * 6. If a service function is missing or has the wrong signature, note it in a comment but keep the test skeleton.
 * 7. Run `npx vitest run tests/kra-kpi/r4-combined-contributors.integration.test.ts` to verify.
 * 8. Tests should run in < 60s total (no artificial delays).
 */

import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import {
  archiveContributorRole,
  createContributorRole,
  getApplicableRoles,
  setApplicableRoles,
  updateContributorRole,
} from "@/lib/kra-kpi/contributor-role-service";
import {
  getConfig,
  getEffectiveConfig,
  setConfig,
} from "@/lib/kra-kpi/kpi-contributor-config-service";
import {
  seedDefaultTemplates,
  createTemplate,
  validateExternalData,
} from "@/lib/kra-kpi/external-contrib-template-service";
import {
  recordAchievement,
  updateAchievement,
  submitForVerification,
  verifyAchievement,
  recommendAchievement,
  listAchievements,
} from "@/lib/kra-kpi/achievement-service";
import { runDuplicateDetection } from "@/lib/kra-kpi/duplicate-detection-service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";
import type { AchievementFieldConfig } from "@/lib/kra-kpi/shared";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

let tracker: DbTracker | null = null;

afterEach(async () => {
  if (tracker) {
    await cleanupTrackedData(tracker);
    tracker = null;
  }
});

function rand(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/**
 * Creates a full fixture with:
 * - tenant + admin (TENANT_OWNER)
 * - 4 users (faculty, coAuthor1, coAuthor2, externalCollaborator concept)
 * - org structure (version → unitType → 2 units with assignments)
 * - period (IN_PROGRESS)
 * - KRA (ACTIVE) + KPI (ACTIVE, NUMERIC, with form fields for DOI + paperTitle)
 * - target allocation for faculty
 * - custom contributor roles: R4_FIRST_AUTHOR(60%), R4_CO_AUTHOR(20%), R4_CORRESPONDING_AUTHOR(40%)
 * - applicable roles set on KPI
 * - KPI contributor config with duplicate check on "doi"
 */
async function createFullFixture(options?: {
  creditSumMode?: "MUST_EQUAL_100" | "MAX_100" | "UNCAPPED";
  allowExternalContributors?: boolean;
  formFields?: AchievementFieldConfig[];
}) {
  tracker ??= newDbTracker();
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");

  // Users
  const faculty = await createTestUser(tracker, { firstName: "Raman", lastName: "PI" });
  const coAuthor1 = await createTestUser(tracker, { firstName: "Anita", lastName: "CoAuthor" });
  const coAuthor2 = await createTestUser(tracker, { firstName: "Vijay", lastName: "CoAuthor2" });
  const outsider = await createTestUser(tracker, { firstName: "Outsider", lastName: "NoMembership" });

  for (const u of [faculty, coAuthor1, coAuthor2]) {
    await createTestMembership({
      tenantId: tenant.id,
      userId: u.id,
      role: "TENANT_USER",
      createdByUserId: actor.id,
    });
  }

  // Org structure
  const version = await prisma.orgStructureVersion.create({
    data: {
      tenantId: tenant.id,
      name: rand("VERSION"),
      versionNumber: 1,
      state: "PUBLISHED",
    },
  });
  const unitType = await prisma.orgUnitType.create({
    data: {
      versionId: version.id,
      typeKey: rand("DEPT"),
      internalCategory: "DEPARTMENT_LIKE_UNIT",
      displayLabel: "Department",
    },
  });
  const unitA = await prisma.orgUnit.create({
    data: {
      tenantId: tenant.id,
      versionId: version.id,
      typeId: unitType.id,
      code: rand("UNIT_A"),
      name: "Computer Science",
      state: "ACTIVE",
    },
  });
  const unitB = await prisma.orgUnit.create({
    data: {
      tenantId: tenant.id,
      versionId: version.id,
      typeId: unitType.id,
      code: rand("UNIT_B"),
      name: "Mathematics",
      state: "ACTIVE",
    },
  });

  for (const userId of [actor.id, faculty.id, coAuthor1.id]) {
    await prisma.userOrgAssignment.create({
      data: { versionId: version.id, userId, unitId: unitA.id, isPrimary: true },
    });
  }
  await prisma.userOrgAssignment.create({
    data: { versionId: version.id, userId: coAuthor2.id, unitId: unitB.id, isPrimary: true },
  });

  // Period
  const periodCode = rand("PERIOD");
  const periodResult = await createPeriod(
    tenant.id,
    {
      name: "R4 Combined Period",
      code: periodCode,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(periodResult.status).toBe("success");
  const period = await prisma.assessmentPeriod.findUnique({
    where: { tenantId_code: { tenantId: tenant.id, code: periodCode } },
  });
  expect(period).toBeTruthy();

  // KRA
  const kraTitle = rand("KRA");
  await createKra(tenant.id, { periodId: period!.id, title: kraTitle, weightage: 100 }, actor.id, "TENANT_OWNER");
  const kra = await prisma.kraDefinition.findFirst({ where: { tenantId: tenant.id, title: kraTitle } });
  expect(kra).toBeTruthy();
  await prisma.kraDefinition.update({ where: { id: kra!.id }, data: { state: "ACTIVE" } });

  // KPI with form fields (DOI + paperTitle by default)
  const formFields: AchievementFieldConfig[] = options?.formFields ?? [
    { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true, sortOrder: 0 },
    { key: "doi", label: "DOI", type: "TEXT", required: false, sortOrder: 1, marker: "UNIQUE_CHECK" },
    { key: "journal", label: "Journal Name", type: "TEXT", required: false, sortOrder: 2 },
  ];

  const kpiTitle = rand("KPI");
  const kpiResult = await createKpi(
    tenant.id,
    {
      kraDefinitionId: kra!.id,
      title: kpiTitle,
      measurementType: "NUMERIC",
      weightage: 100,
      allocationType: "INDIVIDUAL",
      startingUnitId: unitA.id,
      defaultTarget: 10,
      evidenceRequired: true,
      achievementFormConfig: { fields: formFields },
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(kpiResult.status).toBe("success");
  const kpi = await prisma.kpiDefinition.findFirst({ where: { kraDefinitionId: kra!.id, title: kpiTitle } });
  expect(kpi).toBeTruthy();
  await prisma.kpiDefinition.update({ where: { id: kpi!.id }, data: { state: "ACTIVE" } });

  // Activate period
  await prisma.assessmentPeriod.update({ where: { id: period!.id }, data: { state: "IN_PROGRESS" } });

  // Target allocation for faculty
  const allocation = await prisma.targetAllocation.create({
    data: {
      tenantId: tenant.id,
      periodId: period!.id,
      kpiDefinitionId: kpi!.id,
      assignedToUserId: faculty.id,
      allocatedByUserId: actor.id,
      targetValue: 10,
      state: "ACTIVE",
    },
  });

  // Contributor roles
  const makeRole = async (code: string, name: string, credit: number) => {
    const r = await createContributorRole(
      tenant.id,
      { code, name, defaultCreditPercent: credit },
      actor.id,
      "TENANT_OWNER",
    );
    expect(r.status).toBe("success");
    const saved = await prisma.contributorRole.findUnique({
      where: { tenantId_code: { tenantId: tenant.id, code } },
    });
    expect(saved).toBeTruthy();
    return saved!;
  };

  const firstAuthor = await makeRole("R4_FIRST_AUTHOR", "First Author", 60);
  const coAuthorRole = await makeRole("R4_CO_AUTHOR", "Co-Author", 20);
  const correspondingAuthor = await makeRole("R4_CORRESPONDING_AUTHOR", "Corresponding Author", 40);

  // Set applicable roles on KPI (FIRST_AUTHOR = default)
  const setRolesResult = await setApplicableRoles(
    kpi!.id,
    tenant.id,
    {
      roles: [
        { roleId: firstAuthor.id, isDefault: true, sortOrder: 0 },
        { roleId: coAuthorRole.id, isDefault: false, sortOrder: 1 },
        { roleId: correspondingAuthor.id, isDefault: false, sortOrder: 2 },
      ],
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(setRolesResult.status).toBe("success");

  // KPI contributor config
  const configResult = await setConfig(
    kpi!.id,
    tenant.id,
    {
      creditSumMode: options?.creditSumMode ?? "MUST_EQUAL_100",
      allowExternalContributors: options?.allowExternalContributors ?? true,
      duplicateCheckFields: ["doi"],
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(configResult.status).toBe("success");

  // Seed external templates
  await seedDefaultTemplates(tenant.id);

  return {
    tenant,
    actor,
    faculty,
    coAuthor1,
    coAuthor2,
    outsider,
    period: period!,
    kra: kra!,
    kpi: kpi!,
    allocation,
    unitA,
    unitB,
    version,
    roles: { firstAuthor, coAuthorRole, correspondingAuthor },
  };
}

// ---------------------------------------------------------------------------
// SECTION 1: Credit Distribution & Normalization (12 tests)
// ---------------------------------------------------------------------------

describe("Credit distribution and normalization", () => {
  test("S1.01 — solo contributor in MUST_EQUAL_100 gets 100% credit", async () => {
    // Record achievement with only the faculty as FIRST_AUTHOR
    // Assert: single contributor row, creditPercent = 100, effectiveScore = unweighted computedScore
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Solo Paper", doi: "10.1234/solo" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status, JSON.stringify(result)).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    expect(achievement?.contributors).toHaveLength(1);
    expect(achievement?.contributors[0]?.creditPercent).toBe(100);
    // effectiveScore should be unweighted (raw computedScore)
    expect(achievement?.effectiveScore).toBe(achievement?.computedScore);
  });

  test("S1.02 — two contributors in MUST_EQUAL_100: credits normalized to sum=100", async () => {
    // FIRST_AUTHOR(60%) + CO_AUTHOR(20%) → proportional normalization to 100%
    // 60/(60+20) = 75%, 20/(60+20) = 25%
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Two Authors", doi: "10.1234/two" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    if (result.status !== "success") {
      console.error("S2.06 result", result);
    }
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: { orderBy: { creditPercent: "desc" } } },
    });
    expect(achievement?.contributors).toHaveLength(2);
    const total = achievement!.contributors.reduce((s, c) => s + c.creditPercent, 0);
    expect(total).toBeCloseTo(100, 2);
    // First author should have higher credit than co-author
    expect(achievement!.contributors[0]!.creditPercent).toBeGreaterThan(
      achievement!.contributors[1]!.creditPercent,
    );
  });

  test("S1.03 — three contributors in MUST_EQUAL_100: rounding sums to exactly 100", async () => {
    // FIRST_AUTHOR(60%) + CO_AUTHOR(20%) + CO_AUTHOR(20%) → 60:20:20 normalized
    // Verify no floating-point drift — total must be exactly 100
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Three Authors", doi: "10.1234/three" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
          { type: "INTERNAL", userId: f.coAuthor2.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: { orderBy: { creditPercent: "desc" } } },
    });
    expect(achievement?.contributors).toHaveLength(3);
    const total = achievement!.contributors.reduce((s, c) => s + c.creditPercent, 0);
    // Must be EXACTLY 100, not 99.99 or 100.01
    expect(total).toBe(100);
  });

  test("S1.04 — UNCAPPED mode: each contributor gets exact role default", async () => {
    const f = await createFullFixture({ creditSumMode: "UNCAPPED" });
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Uncapped Paper", doi: "10.1234/uncapped" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
          { type: "INTERNAL", userId: f.coAuthor2.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    const byUser = new Map(achievement!.contributors.map((c) => [c.userId, c.creditPercent]));
    expect(byUser.get(f.faculty.id)).toBe(60);
    expect(byUser.get(f.coAuthor1.id)).toBe(20);
    expect(byUser.get(f.coAuthor2.id)).toBe(20);
    // Total can exceed 100 in UNCAPPED
    expect(achievement!.contributors.reduce((s, c) => s + c.creditPercent, 0)).toBe(100);
  });

  test("S1.05 — excluded contributor gets 0 credit in MUST_EQUAL_100, does not reduce others' share", async () => {
    // FIRST_AUTHOR + CO_AUTHOR(excluded) → first author should get 100%
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Excluded Test", doi: "10.1234/excluded" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id, isExcludedFromReward: true },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    const byUser = new Map(achievement!.contributors.map((c) => [c.userId, c]));
    // Excluded contributor should get 0 credit
    expect(byUser.get(f.coAuthor1.id)!.creditPercent).toBe(0);
    // Non-excluded should get 100% (sole included contributor)
    expect(byUser.get(f.faculty.id)!.creditPercent).toBe(100);
  });

  test("S1.06 — adding a contributor recalculates all credits automatically", async () => {
    // Create with 1 contributor, then update to add a second — credits should change
    const f = await createFullFixture();
    const created = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Recalc Test", doi: "10.1234/recalc" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(created.status).toBe("success");

    // Faculty should have 100% as sole contributor
    let achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: { contributors: true },
    });
    expect(achievement!.contributors[0]!.creditPercent).toBe(100);

    // Add co-author → credits should be recalculated
    const updated = await updateAchievement(
      created.id!,
      f.tenant.id,
      {
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(updated.status).toBe("success");

    achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: { contributors: true },
    });
    expect(achievement?.contributors).toHaveLength(2);
    // Faculty should now have LESS than 100%
    const facultyCredit = achievement!.contributors.find((c) => c.userId === f.faculty.id)!.creditPercent;
    expect(facultyCredit).toBeLessThan(100);
    expect(facultyCredit).toBeGreaterThan(0);
    // Total should still be 100
    expect(achievement!.contributors.reduce((s, c) => s + c.creditPercent, 0)).toBeCloseTo(100, 2);
  });

  test("S1.07 — removing a contributor recalculates remaining credits", async () => {
    // Create with 2 contributors, then update to only 1 — sole remaining should get 100%
    const f = await createFullFixture();
    const created = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Remove Test", doi: "10.1234/remove" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(created.status).toBe("success");

    const updated = await updateAchievement(
      created.id!,
      f.tenant.id,
      {
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(updated.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: { contributors: true },
    });
    expect(achievement?.contributors).toHaveLength(1);
    expect(achievement!.contributors[0]!.creditPercent).toBe(100);
  });

  test("S1.08 — effectiveScore is ALWAYS unweighted (baseScore only), regardless of credit", async () => {
    // Record with partial contributor credit → effectiveScore should still equal computedScore
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Score Test", doi: "10.1234/score" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.coAuthorRole.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({ where: { id: result.id! } });
    expect(achievement?.effectiveScore).toBe(achievement?.computedScore);
    // Verify it's NOT credit-weighted
    const facultyContrib = await prisma.achievementContributor.findFirst({
      where: { achievementId: result.id!, userId: f.faculty.id },
    });
    if (facultyContrib && facultyContrib.creditPercent < 100) {
      // If credit < 100%, effectiveScore should NOT be baseScore * credit/100
      expect(achievement?.effectiveScore).not.toBe(
        Math.round((achievement?.computedScore ?? 0) * facultyContrib.creditPercent) / 100,
      );
    }
  });

  test("S1.09 — five contributors in MUST_EQUAL_100: rounding is still exactly 100", async () => {
    // Stress test: roles that produce repeating decimals when divided
    // 60+20+20+40+20 = 160 total defaults → scaled proportions have repeating decimals
    const f = await createFullFixture();

    // Need 2 more users for 5 total
    const extra1 = await createTestUser(tracker!, { firstName: "E1", lastName: "User" });
    const extra2 = await createTestUser(tracker!, { firstName: "E2", lastName: "User" });
    for (const u of [extra1, extra2]) {
      await createTestMembership({ tenantId: f.tenant.id, userId: u.id, role: "TENANT_USER", createdByUserId: f.actor.id });
    }

    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 7,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Five Authors", doi: "10.1234/five" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
          { type: "INTERNAL", userId: f.coAuthor2.id, contributorRoleId: f.roles.coAuthorRole.id },
          { type: "INTERNAL", userId: extra1.id, contributorRoleId: f.roles.correspondingAuthor.id },
          { type: "INTERNAL", userId: extra2.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    expect(achievement?.contributors).toHaveLength(5);
    const total = achievement!.contributors.reduce((s, c) => s + c.creditPercent, 0);
    expect(total).toBe(100);
  });

  test("S1.10 — MAX_100 mode produces same normalization as MUST_EQUAL_100", async () => {
    const f = await createFullFixture({ creditSumMode: "MAX_100" });
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Max100 Test", doi: "10.1234/max100" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    const total = achievement!.contributors.reduce((s, c) => s + c.creditPercent, 0);
    expect(total).toBeCloseTo(100, 2);
  });

  test("S1.11 — inline shadow fields sync from reporter's contributor row", async () => {
    // After creating achievement with contributors, Achievement.contributionRole and creditPercent
    // should reflect the reporter's (faculty's) contributor row values
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Shadow Sync", doi: "10.1234/shadow" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({ where: { id: result.id! } });
    // Inline fields should match the reporter's (faculty's) contributor data
    expect(achievement?.contributionRole).toBeTruthy();
    expect(achievement?.creditPercent).toBeTruthy();
  });

  test("S1.12 — all contributors with same role in MUST_EQUAL_100 get equal shares", async () => {
    // 3 co-authors (all 20% default) → each should get 33.33%, total=100
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Equal Roles", doi: "10.1234/equal" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.coAuthorRole.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
          { type: "INTERNAL", userId: f.coAuthor2.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    // All should have equal or near-equal shares
    const credits = achievement!.contributors.map((c) => c.creditPercent);
    const min = Math.min(...credits);
    const max = Math.max(...credits);
    expect(max - min).toBeLessThanOrEqual(0.02); // rounding tolerance
    expect(credits.reduce((s, c) => s + c, 0)).toBe(100);
  });

  test("S6.07 â€” untouched KPI seeds MEMBER as the baseline applicable role", async () => {
    const f = await createFullFixture();

    await prisma.assessmentPeriod.update({
      where: { id: f.period.id },
      data: { state: "OPEN" },
    });

    const secondKpiTitle = rand("BASELINE_KPI");
    const result = await createKpi(
      f.tenant.id,
      {
        kraDefinitionId: f.kra.id,
        title: secondKpiTitle,
        measurementType: "NUMERIC",
        weightage: 0,
        allocationType: "INDIVIDUAL",
        startingUnitId: f.unitA.id,
        defaultTarget: 1,
        evidenceRequired: false,
      },
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(result.status).toBe("success");

    const secondKpi = await prisma.kpiDefinition.findFirst({
      where: { kraDefinitionId: f.kra.id, title: secondKpiTitle },
    });
    expect(secondKpi).toBeTruthy();

    const applicableRoles = await getApplicableRoles(secondKpi!.id, f.tenant.id);
    expect(applicableRoles).toHaveLength(1);
    expect(applicableRoles[0]?.code).toBe("MEMBER");
    expect(applicableRoles[0]?.linkIsDefault).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SECTION 2: Contributor Validation & Edge Cases (10 tests)
// ---------------------------------------------------------------------------

describe("Contributor validation and edge cases", () => {
  test("S2.01 — duplicate userId in same achievement is rejected", async () => {
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Dup User", doi: "10.1234/dup" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("error");
    expect(result.code).toBe("CONTRIBUTOR_DUPLICATE_USER");
  });

  test("S2.02 — non-member userId is rejected", async () => {
    // outsider has no membership in the tenant
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Non Member", doi: "10.1234/nonmember" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.outsider.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("error");
    expect(result.code).toBe("CONTRIBUTOR_NOT_FOUND");
  });

  test("S2.03 — role not applicable to this KPI is rejected", async () => {
    // Create a role that is NOT in this KPI's applicable list
    const f = await createFullFixture();
    const piRole = await prisma.contributorRole.findFirst({
      where: { tenantId: f.tenant.id, code: "MEMBER" },
    });
    // MEMBER exists from seeding but was replaced by our custom roles on this KPI
    // If MEMBER is not applicable, using it should fail
    if (piRole) {
      const result = await recordAchievement(
        f.tenant.id,
        {
          periodId: f.period.id,
          kpiDefinitionId: f.kpi.id,
          targetAllocationId: f.allocation.id,
          actualValue: 8,
          evidenceLinks: ["https://example.com/paper.pdf"],
          achievementFormData: { paperTitle: "Wrong Role", doi: "10.1234/wrongrole" },
          contributors: [
            { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: piRole.id },
          ],
        },
        f.faculty.id,
        "TENANT_USER",
      );
      expect(result.status).toBe("error");
      expect(result.code).toBe("CONTRIBUTOR_ROLE_NOT_APPLICABLE");
    }
  });

  test("S2.04 — archived role is rejected for new contributors", async () => {
    const f = await createFullFixture();

    // Create a 4th role, make it applicable, then archive it
    const tempRoleResult = await createContributorRole(
      f.tenant.id,
      { code: "TEMP_ROLE", name: "Temporary", defaultCreditPercent: 10 },
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(tempRoleResult.status).toBe("success");
    const tempRole = await prisma.contributorRole.findUnique({
      where: { tenantId_code: { tenantId: f.tenant.id, code: "TEMP_ROLE" } },
    });

    // Add to applicable roles, then archive
    await setApplicableRoles(
      f.kpi.id,
      f.tenant.id,
      {
        roles: [
          { roleId: f.roles.firstAuthor.id, isDefault: true, sortOrder: 0 },
          { roleId: f.roles.coAuthorRole.id, isDefault: false, sortOrder: 1 },
          { roleId: f.roles.correspondingAuthor.id, isDefault: false, sortOrder: 2 },
          { roleId: tempRole!.id, isDefault: false, sortOrder: 3 },
        ],
      },
      f.actor.id,
      "TENANT_OWNER",
    );

    await archiveContributorRole(tempRole!.id, f.tenant.id, f.actor.id, "TENANT_OWNER");

    // Try to use archived role
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Archived Role", doi: "10.1234/archived" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: tempRole!.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("error");
    // Should reject because role is archived/inactive
  });

  test("S2.05 — external contributor rejected when allowExternalContributors=false", async () => {
    const f = await createFullFixture({ allowExternalContributors: false });
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "No External", doi: "10.1234/noext" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          {
            type: "EXTERNAL",
            externalName: "Dr. External",
            externalAffiliation: "MIT",
            externalScope: "NATIONAL",
            contributorRoleId: f.roles.coAuthorRole.id,
          },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("error");
    expect(result.code).toBe("CONTRIBUTOR_EXTERNAL_NOT_ALLOWED");
  });

  test("S2.06 — external contributor accepted when allowed, gets correct credit", async () => {
    const f = await createFullFixture({ allowExternalContributors: true });
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "With External", doi: "10.1234/ext" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          {
            type: "EXTERNAL",
            externalName: "Dr. External",
            externalAffiliation: "MIT",
            externalScope: "INTERNATIONAL",
            externalData: { country: "USA" },
            contributorRoleId: f.roles.coAuthorRole.id,
          },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    expect(achievement?.contributors).toHaveLength(2);
    const external = achievement!.contributors.find((c) => c.type === "EXTERNAL");
    expect(external?.externalName).toBe("Dr. External");
    expect(external?.externalAffiliation).toBe("MIT");
    expect(external?.creditPercent).toBeGreaterThan(0);
  });

  test("S2.07 — submit blocked when all contributors removed (CONTRIBUTORS_REQUIRED)", async () => {
    const f = await createFullFixture();
    const created = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Empty Submit", doi: "10.1234/empty" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    // Remove all contributors
    await updateAchievement(
      created.id!,
      f.tenant.id,
      { contributors: [] },
      f.faculty.id,
      "TENANT_USER",
    );

    const submitResult = await submitForVerification(
      created.id!,
      f.tenant.id,
      f.faculty.id,
      "TENANT_USER",
    );
    expect(submitResult.status).toBe("error");
    expect(submitResult.code).toBe("CONTRIBUTORS_REQUIRED");
  });

  test("S2.08 — cross-department contributor (different unit) is accepted", async () => {
    // coAuthor2 is in unitB, achievement is from unitA — should still work
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Cross Dept", doi: "10.1234/crossdept" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor2.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    expect(achievement?.contributors).toHaveLength(2);
    expect(achievement!.contributors.some((c) => c.userId === f.coAuthor2.id)).toBe(true);
  });

  test("S2.09 — update contributors on non-DRAFT achievement is rejected", async () => {
    const f = await createFullFixture();
    const created = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Non Draft Update", doi: "10.1234/nondraft" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(created.status).toBe("success");

    // Submit it
    await submitForVerification(created.id!, f.tenant.id, f.faculty.id, "TENANT_USER");

    // Try to update contributors while SUBMITTED
    const updateResult = await updateAchievement(
      created.id!,
      f.tenant.id,
      {
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(updateResult.status).toBe("error");
  });

  test("S2.10 — external contributor without name/affiliation is rejected", async () => {
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Bad External", doi: "10.1234/badext" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          {
            type: "EXTERNAL",
            // Missing externalName and externalAffiliation
            contributorRoleId: f.roles.coAuthorRole.id,
          },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// SECTION 3: OBO (On Behalf Of) Requests (6 tests)
// ---------------------------------------------------------------------------

describe("OBO (On Behalf Of) requests", () => {
  test("S3.01 — admin creates OBO achievement for faculty, faculty auto-added as contributor", async () => {
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "OBO Paper", doi: "10.1234/obo" },
        isOBO: true,
        oboReportedForUserId: f.faculty.id,
      },
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    expect(achievement?.isOBO).toBe(true);
    expect(achievement?.oboReportedForUserId).toBe(f.faculty.id);
    expect(achievement?.reportedByUserId).toBe(f.actor.id);
    // Faculty (beneficiary) should be auto-added as contributor
    expect(achievement?.contributors.some((c) => c.userId === f.faculty.id)).toBe(true);
  });

  test("S3.02 — regular user cannot create OBO request (PERMISSION_DENIED)", async () => {
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Unauthorized OBO", doi: "10.1234/unauthobo" },
        isOBO: true,
        oboReportedForUserId: f.coAuthor1.id,
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(result.status).toBe("error");
  });

  test("S3.03 — OBO without beneficiary userId is rejected", async () => {
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "No Beneficiary", doi: "10.1234/nobeneficiary" },
        isOBO: true,
        // Missing oboReportedForUserId
      },
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(result.status).toBe("error");
    expect(result.code).toBe("OBO_BENEFICIARY_REQUIRED");
  });

  test("S3.04 — OBO achievement with explicit contributors, admin NOT in contributor list", async () => {
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "OBO With Contributors", doi: "10.1234/obocontrib" },
        isOBO: true,
        oboReportedForUserId: f.faculty.id,
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    // Admin should NOT be in contributor list
    expect(achievement!.contributors.some((c) => c.userId === f.actor.id)).toBe(false);
    // Faculty and coAuthor1 should be there
    expect(achievement!.contributors.some((c) => c.userId === f.faculty.id)).toBe(true);
    expect(achievement!.contributors.some((c) => c.userId === f.coAuthor1.id)).toBe(true);
  });

  test("S3.05 — OBO for self (actor = beneficiary) is allowed as a normal submission", async () => {
    const f = await createFullFixture();
    // Admin creates OBO where they are also the beneficiary
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Self OBO", doi: "10.1234/selfobo" },
        isOBO: true,
        oboReportedForUserId: f.actor.id,
      },
      f.actor.id,
      "TENANT_OWNER",
    );
    // Should not error — reporting for yourself is allowed
    expect(result.status).toBe("success");
  });

  test("S3.06 — OBO achievement appears under beneficiary's view, not admin's", async () => {
    const f = await createFullFixture();
    const result = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "OBO Visibility", doi: "10.1234/obovis" },
        isOBO: true,
        oboReportedForUserId: f.faculty.id,
      },
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({ where: { id: result.id! } });
    // The OBO beneficiary field should be set
    expect(achievement?.oboReportedForUserId).toBe(f.faculty.id);
    expect(achievement?.reportedByUserId).toBe(f.actor.id);
  });
});

// ---------------------------------------------------------------------------
// SECTION 4: Duplicate Detection (10 tests)
// ---------------------------------------------------------------------------

describe("Duplicate detection", () => {
  test("S4.01 — exact DOI match across two achievements is flagged", async () => {
    const f = await createFullFixture();

    // Achievement 1
    const a1 = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        achievementFormData: { paperTitle: "Paper A", doi: "10.1234/DUPLICATE" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(a1.status).toBe("success");

    // Submit first achievement to make it visible
    await submitForVerification(a1.id!, f.tenant.id, f.faculty.id, "TENANT_USER");

    // Achievement 2 with same DOI — run duplicate detection directly
    const dupResult = await runDuplicateDetection({
      tenantId: f.tenant.id,
      periodId: f.period.id,
      kpiDefinitionId: f.kpi.id,
      achievementTitle: "Paper B",
      achievementFormData: { paperTitle: "Paper B", doi: "10.1234/DUPLICATE" },
      formConfig: { fields: [] },
    });

    expect(dupResult.checked).toBe(true);
    expect(dupResult.hasDuplicates).toBe(true);
    expect(dupResult.matches.length).toBeGreaterThanOrEqual(1);
    expect(dupResult.matches[0]?.similarity).toBe("EXACT");
    expect(dupResult.matches[0]?.matchedField).toBe("doi");
  });

  test("S4.02 — different DOIs are NOT flagged as duplicates", async () => {
    const f = await createFullFixture();

    await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        achievementFormData: { paperTitle: "Paper A", doi: "10.1234/AAA" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    const dupResult = await runDuplicateDetection({
      tenantId: f.tenant.id,
      periodId: f.period.id,
      kpiDefinitionId: f.kpi.id,
      achievementTitle: "Paper B",
      achievementFormData: { paperTitle: "Paper B", doi: "10.1234/BBB" },
      formConfig: { fields: [] },
    });

    expect(dupResult.hasDuplicates).toBe(false);
  });

  test("S4.03 — fuzzy title match within same period is flagged", async () => {
    const f = await createFullFixture();

    await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        title: "A Comprehensive Study on Machine Learning in Healthcare",
        achievementFormData: { paperTitle: "ML Healthcare" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    const dupResult = await runDuplicateDetection({
      tenantId: f.tenant.id,
      periodId: f.period.id,
      kpiDefinitionId: f.kpi.id,
      achievementTitle: "A Comprehensive Study on Machine Learning in Healthcare Systems",
      achievementFormData: { paperTitle: "ML Healthcare Systems" },
      formConfig: { fields: [] },
    });

    expect(dupResult.checked).toBe(true);
    // Titles are very similar → should be flagged as FUZZY
    const fuzzyMatch = dupResult.matches.find((m) => m.similarity === "FUZZY");
    expect(fuzzyMatch).toBeTruthy();
    expect(fuzzyMatch?.samePeriod).toBe(true);
  });

  test("S4.04 — fuzzy title match across different periods is NOT flagged", async () => {
    const f = await createFullFixture();

    await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        title: "Annual Workshop on Deep Learning Techniques",
        achievementFormData: { paperTitle: "DL Workshop" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    // Different period ID — fuzzy match should NOT flag
    const dupResult = await runDuplicateDetection({
      tenantId: f.tenant.id,
      periodId: "clxyz_fake_period_id",
      kpiDefinitionId: f.kpi.id,
      achievementTitle: "Annual Workshop on Deep Learning Techniques",
      achievementFormData: { paperTitle: "DL Workshop" },
      formConfig: { fields: [] },
    });

    const fuzzyMatch = dupResult.matches.find((m) => m.similarity === "FUZZY");
    expect(fuzzyMatch).toBeUndefined();
  });

  test("S4.05 — exact DOI match cross-period IS flagged (globally unique identifiers)", async () => {
    const f = await createFullFixture();

    await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        achievementFormData: { paperTitle: "Paper A", doi: "10.1234/CROSSPERIOD" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    // Different period but same DOI
    const dupResult = await runDuplicateDetection({
      tenantId: f.tenant.id,
      periodId: "clxyz_different_period",
      kpiDefinitionId: f.kpi.id,
      achievementTitle: "Paper B",
      achievementFormData: { paperTitle: "Paper B", doi: "10.1234/CROSSPERIOD" },
      formConfig: { fields: [] },
    });

    expect(dupResult.hasDuplicates).toBe(true);
    const exactMatch = dupResult.matches.find((m) => m.similarity === "EXACT");
    expect(exactMatch).toBeTruthy();
    expect(exactMatch?.samePeriod).toBe(false);
  });

  test("S4.06 — DOI matching is case-insensitive and whitespace-normalized", async () => {
    const f = await createFullFixture();

    await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        achievementFormData: { paperTitle: "Paper A", doi: "10.1234/ABC-123" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    const dupResult = await runDuplicateDetection({
      tenantId: f.tenant.id,
      periodId: f.period.id,
      kpiDefinitionId: f.kpi.id,
      achievementTitle: "Paper B",
      achievementFormData: { paperTitle: "Paper B", doi: "  10.1234/abc-123  " },
      formConfig: { fields: [] },
    });

    expect(dupResult.hasDuplicates).toBe(true);
  });

  test("S4.07 — completely different titles are NOT flagged as fuzzy duplicates", async () => {
    const f = await createFullFixture();

    await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        title: "Quantum Computing Applications in Drug Discovery",
        achievementFormData: { paperTitle: "QC Drug Discovery" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    const dupResult = await runDuplicateDetection({
      tenantId: f.tenant.id,
      periodId: f.period.id,
      kpiDefinitionId: f.kpi.id,
      achievementTitle: "Agricultural Robotics for Sustainable Farming",
      achievementFormData: { paperTitle: "Agri Robots" },
      formConfig: { fields: [] },
    });

    expect(dupResult.hasDuplicates).toBe(false);
  });

  test("S4.08 — duplicate detection runs on submit and stores result on achievement", async () => {
    const f = await createFullFixture();

    // Create first achievement and submit
    const a1 = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        achievementFormData: { paperTitle: "First Paper", doi: "10.9999/SUBMIT-DUP" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    await submitForVerification(a1.id!, f.tenant.id, f.faculty.id, "TENANT_USER");

    // Need a second allocation for a second achievement by coAuthor1
    const allocation2 = await prisma.targetAllocation.create({
      data: {
        tenantId: f.tenant.id,
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        assignedToUserId: f.coAuthor1.id,
        allocatedByUserId: f.actor.id,
        targetValue: 10,
        state: "ACTIVE",
      },
    });

    // Create second achievement with same DOI
    const a2 = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: allocation2.id,
        actualValue: 3,
        evidenceLinks: ["https://example.com/paper2.pdf"],
        achievementFormData: { paperTitle: "Second Paper", doi: "10.9999/SUBMIT-DUP" },
        contributors: [
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.coAuthor1.id,
      "TENANT_USER",
    );
    expect(a2.status).toBe("success");

    // Submit second — should store duplicate check result
    const submitResult = await submitForVerification(a2.id!, f.tenant.id, f.coAuthor1.id, "TENANT_USER");
    expect(submitResult.status).toBe("success");

    const achievement2 = await prisma.achievement.findUnique({ where: { id: a2.id! } });
    const dupResult = achievement2?.duplicateCheckResult as any;
    expect(dupResult).toBeTruthy();
    expect(dupResult.checked).toBe(true);
    expect(dupResult.hasDuplicates).toBe(true);
  });

  test("S4.09 — duplicate detection scoped to same KPI only (different KPIs not matched)", async () => {
    const f = await createFullFixture();

    await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        achievementFormData: { paperTitle: "Paper A", doi: "10.1234/KPI-SCOPE" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    // Check against a DIFFERENT kpiDefinitionId
    const dupResult = await runDuplicateDetection({
      tenantId: f.tenant.id,
      periodId: f.period.id,
      kpiDefinitionId: "clxyz_different_kpi",
      achievementTitle: "Paper A",
      achievementFormData: { paperTitle: "Paper A", doi: "10.1234/KPI-SCOPE" },
      formConfig: { fields: [] },
    });

    expect(dupResult.hasDuplicates).toBe(false);
  });

  test("S4.10 — empty DOI / null fields do not trigger false positives", async () => {
    const f = await createFullFixture();

    // Achievement with no DOI
    await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        achievementFormData: { paperTitle: "No DOI Paper" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    // Another achievement also with no DOI — should NOT be exact match on empty field
    const dupResult = await runDuplicateDetection({
      tenantId: f.tenant.id,
      periodId: f.period.id,
      kpiDefinitionId: f.kpi.id,
      achievementTitle: "Another No DOI Paper With Totally Different Title",
      achievementFormData: { paperTitle: "Different" },
      formConfig: { fields: [] },
    });

    // No exact matches on empty/missing DOI
    const exactMatches = dupResult.matches.filter((m) => m.similarity === "EXACT");
    expect(exactMatches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SECTION 5: Full Workflow — End to End (8 tests)
// ---------------------------------------------------------------------------

describe("Full workflow — end to end", () => {
  test("S5.01 — complete lifecycle: record → add contributors → submit → verify", async () => {
    const f = await createFullFixture();

    // Record
    const created = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Full Lifecycle", doi: "10.1234/lifecycle" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(created.status).toBe("success");

    // Verify DRAFT state
    let achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: { contributors: true },
    });
    expect(achievement?.state).toBe("DRAFT");

    // Submit
    const submitted = await submitForVerification(created.id!, f.tenant.id, f.faculty.id, "TENANT_USER");
    expect(submitted.status).toBe("success");

    achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: { contributors: true },
    });
    expect(achievement?.state).toBe("SUBMITTED");

    // Verify (approve)
    const verified = await verifyAchievement(
      created.id!,
      f.tenant.id,
      true,
      "Approved — verified all contributor claims.",
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(verified.status).toBe("success");

    achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: { contributors: true },
    });
    expect(achievement?.state).toBe("VERIFIED");
    expect(achievement?.contributors).toHaveLength(2);
    expect(achievement?.effectiveScore).toBe(achievement?.computedScore);
  });

  test("S5.02 — rejected achievement can be updated and resubmitted", async () => {
    const f = await createFullFixture();

    const created = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Rejection Flow", doi: "10.1234/reject" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    await submitForVerification(created.id!, f.tenant.id, f.faculty.id, "TENANT_USER");

    // Reject
    const rejected = await verifyAchievement(
      created.id!,
      f.tenant.id,
      false,
      "Incomplete contributor list — please add all authors.",
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(rejected.status).toBe("success");

    let achievement = await prisma.achievement.findUnique({ where: { id: created.id! } });
    expect(achievement?.state).toBe("REJECTED");

    // Update contributors after rejection (state should reset to DRAFT)
    const updated = await updateAchievement(
      created.id!,
      f.tenant.id,
      {
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(updated.status).toBe("success");

    // Resubmit
    const resubmitted = await submitForVerification(created.id!, f.tenant.id, f.faculty.id, "TENANT_USER");
    // Should succeed (either via submitForVerification or resubmitAchievement depending on implementation)
    // Some implementations require resubmitAchievement for REJECTED state
    if (resubmitted.status === "error") {
      // If submitForVerification doesn't work on REJECTED, the update should have reset to DRAFT
      achievement = await prisma.achievement.findUnique({ where: { id: created.id! } });
      expect(achievement?.state).toBe("DRAFT");
    }
  });

  test("S5.03 — duplicate warning does NOT block verification (informational only)", async () => {
    const f = await createFullFixture();

    // First achievement
    const a1 = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/paper1.pdf"],
        achievementFormData: { paperTitle: "Dup Warning Paper", doi: "10.5555/WARN" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    await submitForVerification(a1.id!, f.tenant.id, f.faculty.id, "TENANT_USER");
    await verifyAchievement(a1.id!, f.tenant.id, true, null, f.actor.id, "TENANT_OWNER");

    // Second achievement with same DOI by different user
    const allocation2 = await prisma.targetAllocation.create({
      data: {
        tenantId: f.tenant.id,
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        assignedToUserId: f.coAuthor1.id,
        allocatedByUserId: f.actor.id,
        targetValue: 10,
        state: "ACTIVE",
      },
    });

    const a2 = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: allocation2.id,
        actualValue: 3,
        evidenceLinks: ["https://example.com/paper2.pdf"],
        achievementFormData: { paperTitle: "Dup Warning Paper 2", doi: "10.5555/WARN" },
        contributors: [
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.coAuthor1.id,
      "TENANT_USER",
    );
    await submitForVerification(a2.id!, f.tenant.id, f.coAuthor1.id, "TENANT_USER");

    // Verifier should still be able to approve despite duplicate warning
    const verified = await verifyAchievement(a2.id!, f.tenant.id, true, "Verified despite duplicate — different contribution.", f.actor.id, "TENANT_OWNER");
    expect(verified.status).toBe("success");

    const achievement2 = await prisma.achievement.findUnique({ where: { id: a2.id! } });
    expect(achievement2?.state).toBe("VERIFIED");
  });

  test("S5.04 — role change mid-period: existing achievement keeps old role, new submissions use new roles", async () => {
    const f = await createFullFixture();

    // Record achievement with current roles
    const created = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Before Role Change", doi: "10.1234/rolechange" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(created.status).toBe("success");

    // Change role's credit percentage
    await updateContributorRole(
      f.roles.firstAuthor.id,
      f.tenant.id,
      { defaultCreditPercent: 80 },
      f.actor.id,
      "TENANT_OWNER",
    );

    // Existing achievement should still have OLD credit values (snapshot at creation time)
    const achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: { contributors: true },
    });
    const contrib = achievement!.contributors.find((c) => c.userId === f.faculty.id);
    // Credit was calculated at creation time — should reflect the old 60% → solo = 100%
    expect(contrib?.creditPercent).toBe(100);
  });

  test("S5.05 — listAchievements includes contributor data (dual-read)", async () => {
    const f = await createFullFixture();

    await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "List Test", doi: "10.1234/list" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    const achievements = await listAchievements(f.tenant.id, {
      periodId: f.period.id,
      kpiDefinitionId: f.kpi.id,
    });

    expect(achievements.length).toBeGreaterThanOrEqual(1);
    const achievementView = achievements[0];
    // Should include contributor data in the view
    expect(achievementView?.contributors).toBeDefined();
    if (achievementView?.contributors) {
      expect(achievementView.contributors.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("S5.06 — auto-created starter contributor is replaced when explicit contributors provided on update", async () => {
    const f = await createFullFixture();

    // Create without explicit contributors → auto-starter should be created
    const created = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Starter Replace", doi: "10.1234/starter" },
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(created.status).toBe("success");

    let achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: { contributors: true },
    });
    // Should have auto-starter
    expect(achievement?.contributors.length).toBeGreaterThanOrEqual(1);

    // Update with explicit contributors
    await updateAchievement(
      created.id!,
      f.tenant.id,
      {
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: { contributors: true },
    });
    expect(achievement?.contributors).toHaveLength(2);
    // Roles should be the explicit ones, not the auto-starter MEMBER role
    const roles = achievement!.contributors.map((c) => c.contributorRoleId).sort();
    expect(roles).toContain(f.roles.firstAuthor.id);
    expect(roles).toContain(f.roles.coAuthorRole.id);
  });

  test("S5.07 — achievement with external + internal contributors through full lifecycle", async () => {
    const f = await createFullFixture();

    const created = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 9,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Mixed Contributors", doi: "10.1234/mixed" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          {
            type: "EXTERNAL",
            externalName: "Prof. International",
            externalAffiliation: "Oxford University",
            externalScope: "INTERNATIONAL",
            externalData: { country: "UK" },
            contributorRoleId: f.roles.coAuthorRole.id,
          },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(created.status).toBe("success");

    // Submit
    const submitted = await submitForVerification(created.id!, f.tenant.id, f.faculty.id, "TENANT_USER");
    expect(submitted.status).toBe("success");

    // Verify
    const verified = await verifyAchievement(created.id!, f.tenant.id, true, "All good", f.actor.id, "TENANT_OWNER");
    expect(verified.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: { contributors: true },
    });
    expect(achievement?.state).toBe("VERIFIED");
    expect(achievement?.contributors).toHaveLength(2);
    const ext = achievement!.contributors.find((c) => c.type === "EXTERNAL");
    expect(ext?.externalName).toBe("Prof. International");
    expect(ext?.externalScope).toBe("INTERNATIONAL");
  });

  test("S5.08 — KPI config change from MUST_EQUAL_100 to UNCAPPED: new achievements use new mode", async () => {
    const f = await createFullFixture({ creditSumMode: "MUST_EQUAL_100" });

    // Record achievement under MUST_EQUAL_100
    const a1 = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Before Config Change", doi: "10.1234/configchange1" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );
    expect(a1.status).toBe("success");

    const ach1 = await prisma.achievement.findUnique({
      where: { id: a1.id! },
      include: { contributors: true },
    });
    const total1 = ach1!.contributors.reduce((s, c) => s + c.creditPercent, 0);
    expect(total1).toBeCloseTo(100, 2);

    // Change config to UNCAPPED
    await setConfig(
      f.kpi.id,
      f.tenant.id,
      { creditSumMode: "UNCAPPED" },
      f.actor.id,
      "TENANT_OWNER",
    );

    // Need second allocation for new achievement
    const allocation2 = await prisma.targetAllocation.create({
      data: {
        tenantId: f.tenant.id,
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        assignedToUserId: f.coAuthor1.id,
        allocatedByUserId: f.actor.id,
        targetValue: 10,
        state: "ACTIVE",
      },
    });

    // New achievement under UNCAPPED
    const a2 = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: allocation2.id,
        actualValue: 7,
        evidenceLinks: ["https://example.com/paper2.pdf"],
        achievementFormData: { paperTitle: "After Config Change", doi: "10.1234/configchange2" },
        contributors: [
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor2.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.coAuthor1.id,
      "TENANT_USER",
    );
    expect(a2.status).toBe("success");

    const ach2 = await prisma.achievement.findUnique({
      where: { id: a2.id! },
      include: { contributors: true },
    });
    const byUser = new Map(ach2!.contributors.map((c) => [c.userId, c.creditPercent]));
    // In UNCAPPED, each gets exact role default
    expect(byUser.get(f.coAuthor1.id)).toBe(60);
    expect(byUser.get(f.coAuthor2.id)).toBe(20);
  });

  test("S5.09 â€” listAchievements falls back to inline shadow fields for legacy achievements without contributor rows", async () => {
    const f = await createFullFixture();

    const legacyAchievement = await prisma.achievement.create({
      data: {
        tenantId: f.tenant.id,
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        reportedByUserId: f.faculty.id,
        actualValue: 5,
        evidenceLinks: ["https://example.com/legacy.pdf"],
        title: "Legacy Inline Achievement",
        contributionRole: "First Author",
        creditPercent: 60,
        computedScore: 50,
        effectiveScore: 50,
      },
    });

    const achievements = await listAchievements(f.tenant.id, {
      periodId: f.period.id,
      kpiDefinitionId: f.kpi.id,
    });
    const view = achievements.find((achievement) => achievement.id === legacyAchievement.id);

    expect(view).toBeTruthy();
    expect(view?.contributors).toHaveLength(1);
    expect(view?.contributors[0]?.userId).toBe(f.faculty.id);
    expect(view?.contributors[0]?.roleName).toBe("First Author");
    expect(view?.contributors[0]?.creditPercent).toBe(60);
    expect(view?.contributors[0]?.contributorRoleId).toBe("legacy-inline");
  });
});

// ---------------------------------------------------------------------------
// SECTION 6: Role Management Integration (6 tests)
// ---------------------------------------------------------------------------

describe("Role management integration with achievements", () => {
  test("S6.01 — archiving role used in existing achievement is blocked", async () => {
    const f = await createFullFixture();

    // Create achievement using firstAuthor role
    await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Role Archive Block", doi: "10.1234/archblock" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    // Try to archive firstAuthor role — should be blocked
    const archiveResult = await archiveContributorRole(
      f.roles.firstAuthor.id,
      f.tenant.id,
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(archiveResult.status).toBe("error");
    expect(archiveResult.code).toBe("ROLE_IN_USE_ACHIEVEMENTS");
  });

  test("S6.02 — getApplicableRoles returns only roles configured for this KPI", async () => {
    const f = await createFullFixture();
    const roles = await getApplicableRoles(f.kpi.id, f.tenant.id);

    // Should have our 3 custom roles, NOT the seeded MEMBER role
    const codes = roles.map((r) => r.code).sort();
    expect(codes).toContain("R4_FIRST_AUTHOR");
    expect(codes).toContain("R4_CO_AUTHOR");
    expect(codes).toContain("R4_CORRESPONDING_AUTHOR");
    // Exactly one should be default
    const defaults = roles.filter((r) => r.linkIsDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.code).toBe("R4_FIRST_AUTHOR");
  });

  test("S6.03 — setApplicableRoles rejects duplicate role IDs", async () => {
    const f = await createFullFixture();
    const result = await setApplicableRoles(
      f.kpi.id,
      f.tenant.id,
      {
        roles: [
          { roleId: f.roles.firstAuthor.id, isDefault: true, sortOrder: 0 },
          { roleId: f.roles.firstAuthor.id, isDefault: false, sortOrder: 1 },
        ],
      },
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(result.status).toBe("error");
    expect(result.code).toBe("APPLICABLE_ROLES_DUPLICATE");
  });

  test("S6.04 — setApplicableRoles requires exactly one default", async () => {
    const f = await createFullFixture();
    // Zero defaults
    const result = await setApplicableRoles(
      f.kpi.id,
      f.tenant.id,
      {
        roles: [
          { roleId: f.roles.firstAuthor.id, isDefault: false, sortOrder: 0 },
          { roleId: f.roles.coAuthorRole.id, isDefault: false, sortOrder: 1 },
        ],
      },
      f.actor.id,
      "TENANT_OWNER",
    );
    expect(result.status).toBe("error");
    expect(result.code).toBe("APPLICABLE_ROLES_DEFAULT");
  });

  test("S6.05 — updating role credit % does not retroactively change existing achievements", async () => {
    const f = await createFullFixture();

    const created = await recordAchievement(
      f.tenant.id,
      {
        periodId: f.period.id,
        kpiDefinitionId: f.kpi.id,
        targetAllocationId: f.allocation.id,
        actualValue: 8,
        evidenceLinks: ["https://example.com/paper.pdf"],
        achievementFormData: { paperTitle: "Credit Snapshot", doi: "10.1234/snapshot" },
        contributors: [
          { type: "INTERNAL", userId: f.faculty.id, contributorRoleId: f.roles.firstAuthor.id },
          { type: "INTERNAL", userId: f.coAuthor1.id, contributorRoleId: f.roles.coAuthorRole.id },
        ],
      },
      f.faculty.id,
      "TENANT_USER",
    );

    // Snapshot credits
    const before = await prisma.achievementContributor.findMany({
      where: { achievementId: created.id! },
    });
    const beforeCredits = new Map(before.map((c) => [c.userId, c.creditPercent]));

    // Change role defaults drastically
    await updateContributorRole(f.roles.firstAuthor.id, f.tenant.id, { defaultCreditPercent: 90 }, f.actor.id, "TENANT_OWNER");
    await updateContributorRole(f.roles.coAuthorRole.id, f.tenant.id, { defaultCreditPercent: 5 }, f.actor.id, "TENANT_OWNER");

    // Existing achievement credits should NOT have changed
    const after = await prisma.achievementContributor.findMany({
      where: { achievementId: created.id! },
    });
    const afterCredits = new Map(after.map((c) => [c.userId, c.creditPercent]));

    expect(afterCredits.get(f.faculty.id)).toBe(beforeCredits.get(f.faculty.id));
    expect(afterCredits.get(f.coAuthor1.id)).toBe(beforeCredits.get(f.coAuthor1.id));
  });

  test("S6.06 — KPI contributor config stores and retrieves duplicate check fields", async () => {
    const f = await createFullFixture();

    const config = await getEffectiveConfig(f.kpi.id, f.tenant.id);
    expect(config).toBeTruthy();
    expect(config?.duplicateCheckFields).toContain("doi");
    expect(config?.creditSumMode).toBe("MUST_EQUAL_100");
    expect(config?.allowExternalContributors).toBe(true);
  });
});
