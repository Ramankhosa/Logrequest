import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import type { KpiBuilderPayload } from "@/lib/kra-kpi/builder-shared";
import { saveKpiBuilder } from "@/lib/kra-kpi/kpi-builder-service";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import { getMyAllocations } from "@/lib/kra-kpi/my-kpi-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { seedDefaultBenefitTypes } from "@/lib/kra-kpi/benefit-type-service";
import { seedDefaultContributorRoles } from "@/lib/kra-kpi/contributor-role-service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

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

describe("R4.2 application submission config", () => {
  test("getMyAllocations exposes admin-authored front-facing KPI config to the target user", async () => {
    tracker ??= newDbTracker();
    const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
    const faculty = await createTestUser(tracker, {
      firstName: "Faculty",
      lastName: "Member",
    });
    await createTestMembership({
      tenantId: tenant.id,
      userId: faculty.id,
      role: "TENANT_USER",
      createdByUserId: actor.id,
    });

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

    const unit = await prisma.orgUnit.create({
      data: {
        tenantId: tenant.id,
        versionId: version.id,
        typeId: unitType.id,
        code: rand("UNIT"),
        name: "Research Department",
        state: "ACTIVE",
      },
    });

    const periodCode = rand("PERIOD");
    const periodResult = await createPeriod(
      tenant.id,
      {
        name: "Application Config Period",
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
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: periodCode,
        },
      },
    });
    expect(period).toBeTruthy();

    const kraResult = await createKra(
      tenant.id,
      {
        periodId: period!.id,
        title: rand("KRA"),
        weightage: 100,
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(kraResult.status).toBe("success");

    const kra = await prisma.kraDefinition.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
    });
    expect(kra).toBeTruthy();

    await prisma.kraDefinition.update({
      where: { id: kra!.id },
      data: { state: "ACTIVE" },
    });

    await seedDefaultContributorRoles(tenant.id);
    await seedDefaultBenefitTypes(tenant.id);

    const leadRole = await prisma.contributorRole.findFirst({
      where: { tenantId: tenant.id, code: "LEAD_AUTHOR" },
    });
    const coRole = await prisma.contributorRole.findFirst({
      where: { tenantId: tenant.id, code: "CO_AUTHOR" },
    });
    const benefit = await prisma.benefitType.findFirst({
      where: { tenantId: tenant.id, code: "MONETARY" },
    });
    expect(leadRole).toBeTruthy();
    expect(coRole).toBeTruthy();
    expect(benefit).toBeTruthy();

    const payload: KpiBuilderPayload = {
      definition: {
        kraDefinitionId: kra!.id,
        title: "Publication KPI",
        measurementType: "NUMERIC",
        unitLabel: "papers",
        weightage: 50,
        defaultTarget: 5,
        measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: null,
        isPerCapita: false,
        allocationType: "INDIVIDUAL",
        startingUnitId: unit.id,
        achievementTemplateKey: null,
        achievementFormConfig: {
          fields: [
            {
              key: "publicationType",
              label: "Publication Type",
              type: "SELECT",
              required: true,
              options: ["JOURNAL", "CONFERENCE"],
              sortOrder: 0,
              defaultValue: "JOURNAL",
            },
            {
              key: "journalTier",
              label: "Journal Tier",
              type: "SELECT",
              required: false,
              options: ["Q1", "Q2", "Q3", "Q4"],
              sortOrder: 1,
              visibilityRules: [
                { fieldKey: "publicationType", operator: "eq", value: "JOURNAL" },
              ],
              requiredRules: [
                { fieldKey: "publicationType", operator: "eq", value: "JOURNAL" },
              ],
            },
            {
              key: "publicationDate",
              label: "Publication Date",
              type: "DATE",
              required: true,
              sortOrder: 2,
              binding: "POLICY_DATE_FIELD",
            },
          ],
        },
        keyUnitId: null,
        finalUnitId: null,
        sopDescription: null,
        evidenceRequired: true,
        evidenceTypes: ["DOCUMENT", "URL"],
        evidenceInstructions: "Attach the publication proof and DOI link.",
        isTeamKpi: true,
        teamCreditMethod: "WEIGHTED_SPLIT",
        allowPartialCompletion: true,
        allowMultipleAchievementsPerAllocation: false,
        participantMode: "OPTIONAL_TEAM",
        rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
        policyDateFieldKey: "publicationDate",
        sortOrder: 0,
        guidanceNotes: "Mark first and corresponding authors correctly.",
      },
      applicableRoles: [
        { roleId: leadRole!.id, isDefault: true, sortOrder: 0 },
        { roleId: coRole!.id, isDefault: false, sortOrder: 1 },
      ],
      contributorConfig: {
        allowExternalContributors: true,
        duplicateCheckFields: ["publicationDate"],
        creditSumMode: "MUST_EQUAL_100",
      },
      stages: [],
      rewardTiers: [],
      rewardComponents: [
        {
          code: "TEAM_REWARD",
          name: "Team Reward",
          benefitTypeId: benefit!.id,
          benefitTypeCode: benefit!.code,
          trigger: "FINAL_VERIFY",
          amountMode: "FIXED_POOL",
          amountValue: 35000,
          distributionMode: "ROLE_PERCENT_SPLIT",
          singleEligibleHandling: "FULL_TO_SINGLE",
          emptyShareHandling: "ROLLOVER_TO_MATCHED",
          sortOrder: 0,
          isActive: true,
          distributions: [
            {
              selectorType: "SELECTOR_TAG",
              selectorTag: "FIRST_AUTHOR",
              sharePercent: 70,
              splitMode: "FULL_TO_MATCHED",
              sortOrder: 0,
            },
            {
              selectorType: "REMAINDER",
              sharePercent: 30,
              splitMode: "EQUAL",
              sortOrder: 1,
            },
          ],
        },
      ],
    };

    const saveResult = await saveKpiBuilder(
      tenant.id,
      payload,
      actor.id,
      "TENANT_OWNER",
    );
    expect(saveResult.status).toBe("success");

    await prisma.kpiDefinition.update({
      where: { id: saveResult.id! },
      data: { state: "ACTIVE" },
    });

    await prisma.targetAllocation.create({
      data: {
        tenantId: tenant.id,
        periodId: period!.id,
        kpiDefinitionId: saveResult.id!,
        assignedToUserId: faculty.id,
        allocatedByUserId: actor.id,
        targetValue: 5,
        state: "ACTIVE",
      },
    });

    const allocations = await getMyAllocations(tenant.id, faculty.id, period!.id);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.submissionConfig.participantMode).toBe("OPTIONAL_TEAM");
    expect(allocations[0]?.submissionConfig.evidenceRequired).toBe(true);
    expect(allocations[0]?.submissionConfig.evidenceInstructions).toContain("publication proof");
    expect(allocations[0]?.submissionConfig.applicableRoles.map((role) => role.code)).toEqual([
      "LEAD_AUTHOR",
      "CO_AUTHOR",
    ]);
    expect(allocations[0]?.submissionConfig.allowExternalContributors).toBe(true);
    expect(
      allocations[0]?.submissionConfig.externalContributorFields?.some(
        (field) => field.key === "name",
      ),
    ).toBe(true);
    expect(allocations[0]?.submissionConfig.contributorSelectorTags).toEqual([
      "FIRST_AUTHOR",
    ]);
  });

  test("getMyAllocations rehydrates publication applicable roles when old KPI links are missing", async () => {
    tracker ??= newDbTracker();
    const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
    const faculty = await createTestUser(tracker, {
      firstName: "Publication",
      lastName: "Faculty",
    });
    await createTestMembership({
      tenantId: tenant.id,
      userId: faculty.id,
      role: "TENANT_USER",
      createdByUserId: actor.id,
    });

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

    const unit = await prisma.orgUnit.create({
      data: {
        tenantId: tenant.id,
        versionId: version.id,
        typeId: unitType.id,
        code: rand("UNIT"),
        name: "Publication Department",
        state: "ACTIVE",
      },
    });

    const periodCode = rand("PERIOD");
    const periodResult = await createPeriod(
      tenant.id,
      {
        name: "Publication Roles Period",
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
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: periodCode,
        },
      },
    });
    expect(period).toBeTruthy();

    const kraResult = await createKra(
      tenant.id,
      {
        periodId: period!.id,
        title: rand("KRA"),
        weightage: 100,
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(kraResult.status).toBe("success");

    const kra = await prisma.kraDefinition.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
    });
    expect(kra).toBeTruthy();

    await prisma.kraDefinition.update({
      where: { id: kra!.id },
      data: { state: "ACTIVE" },
    });

    await seedDefaultContributorRoles(tenant.id);

    const createResult = await createKpi(
      tenant.id,
      {
        kraDefinitionId: kra!.id,
        title: "Legacy Publication KPI",
        measurementType: "NUMERIC",
        unitLabel: "papers",
        weightage: 40,
        defaultTarget: 1,
        allocationType: "INDIVIDUAL",
        startingUnitId: unit.id,
        achievementTemplateKey: "PUBLICATION",
        evidenceRequired: true,
        evidenceTypes: ["DOCUMENT", "URL"],
        isTeamKpi: true,
        teamCreditMethod: "WEIGHTED_SPLIT",
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(createResult.status).toBe("success");
    expect(createResult.id).toBeTruthy();

    await prisma.kpiDefinition.update({
      where: { id: createResult.id! },
      data: { state: "ACTIVE" },
    });

    await prisma.targetAllocation.create({
      data: {
        tenantId: tenant.id,
        periodId: period!.id,
        kpiDefinitionId: createResult.id!,
        assignedToUserId: faculty.id,
        allocatedByUserId: actor.id,
        targetValue: 1,
        state: "ACTIVE",
      },
    });

    await prisma.kpiApplicableRole.deleteMany({
      where: { kpiDefinitionId: createResult.id! },
    });

    const allocations = await getMyAllocations(tenant.id, faculty.id, period!.id);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.submissionConfig.applicableRoles.map((role) => role.code)).toEqual([
      "LEAD_AUTHOR",
      "CO_AUTHOR",
      "CORRESPONDING",
    ]);

    const persistedRoles = await prisma.kpiApplicableRole.findMany({
      where: { kpiDefinitionId: createResult.id! },
      include: { contributorRole: { select: { code: true } } },
      orderBy: { sortOrder: "asc" },
    });
    expect(persistedRoles.map((role) => role.contributorRole.code)).toEqual([
      "LEAD_AUTHOR",
      "CO_AUTHOR",
      "CORRESPONDING",
    ]);
  });
});
