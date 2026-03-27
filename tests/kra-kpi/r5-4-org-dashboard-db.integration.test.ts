import type { KpiMeasurementType } from "@prisma/client";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getCrossUnitComparison,
  getDrillDownNode,
  getKpiPeriodComparison,
  getOrgHierarchyStats,
} from "@/lib/kra-kpi/dashboard-service";
import { recordAchievement } from "@/lib/kra-kpi/achievement-service";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import { activateKra, createKra } from "@/lib/kra-kpi/kra-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { createAllocation } from "@/lib/kra-kpi/target-service";
import { resolveDashboardOrgNodeSelection } from "@/lib/org-structure/scope-resolver";
import {
  createScenarioAllocation,
  createWorkflowCoreFixture,
  withKraKpiScenarioDb,
} from "../helpers/kra-kpi-db-scenarios";

function uniqueCode(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function createMeasuredKpi(input: {
  tenantId: string;
  periodId: string;
  kraId: string;
  actorUserId: string;
  title: string;
  measurementType: KpiMeasurementType;
  unitLabel: string | null;
  measurementConfig: Record<string, unknown>;
  startingUnitId: string;
  finalUnitId?: string;
}) {
  const result = await createKpi(
    input.tenantId,
    {
      kraDefinitionId: input.kraId,
      title: input.title,
      description: `${input.title} org drill-down test`,
      measurementType: input.measurementType,
      unitLabel: input.unitLabel ?? undefined,
      weightage: 100,
      measurementConfig: input.measurementConfig as never,
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: { method: "LINEAR", capAt100: true },
      allocationType: "INDIVIDUAL",
      startingUnitId: input.startingUnitId,
      ...(input.finalUnitId ? { finalUnitId: input.finalUnitId } : {}),
      allowPartialCompletion: true,
      sortOrder: 20,
    },
    input.actorUserId,
    "TENANT_OWNER",
  );

  expect(result.status).toBe("success");
  await prisma.kpiDefinition.update({
    where: { id: result.id! },
    data: { state: "ACTIVE" },
  });
  return result.id!;
}

async function createEditablePeriodWithKra(input: {
  tenantId: string;
  actorUserId: string;
  periodCode: string;
  periodName: string;
  kraTitle: string;
}) {
  const periodResult = await createPeriod(
    input.tenantId,
    {
      name: input.periodName,
      code: input.periodCode,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2027-01-01T00:00:00.000Z"),
      endDate: new Date("2027-12-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: new Date("2027-01-31T00:00:00.000Z"),
      achievementDeadline: new Date("2027-12-15T00:00:00.000Z"),
      reviewDeadline: new Date("2027-12-31T00:00:00.000Z"),
    },
    input.actorUserId,
    "TENANT_OWNER",
  );
  expect(periodResult.status).toBe("success");

  const period = await prisma.assessmentPeriod.findUniqueOrThrow({
    where: { id: periodResult.id! },
    select: { id: true },
  });

  const kraResult = await createKra(
    input.tenantId,
    {
      periodId: period.id,
      title: input.kraTitle,
      weightage: 100,
      sortOrder: 1,
    },
    input.actorUserId,
    "TENANT_OWNER",
  );
  expect(kraResult.status).toBe("success");

  const kra = await prisma.kraDefinition.findUniqueOrThrow({
    where: { id: kraResult.id! },
    select: { id: true },
  });

  await prisma.assessmentPeriod.update({
    where: { id: period.id },
    data: { state: "OPEN" },
  });

  return { period, kra };
}

describe("R5.4 organization dashboard database coverage", () => {
  test("DESCENDANTS heads get root landing plus school-node child metrics limited to their subtree", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker);

      await prisma.orgRoleAssignment.updateMany({
        where: {
          versionId: fixture.structure.versionId,
          userId: fixture.users.schoolHead.id,
          unitId: fixture.structure.schoolUnitId,
        },
        data: { scope: "DESCENDANTS" },
      });

      await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 10,
        notes: uniqueCode("R54_ORG_CSE"),
      });
      await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.finalOnly.id,
        assignedToUserId: fixture.users.facultyEce.id,
        targetValue: 12,
        notes: uniqueCode("R54_ORG_ECE"),
      });

      const rootSelection = await resolveDashboardOrgNodeSelection(
        fixture.tenant.id,
        fixture.users.schoolHead.id,
      );
      expect(rootSelection.currentNode).toBeNull();
      expect(rootSelection.entryRoots.map((unit) => unit.unitId)).toEqual([
        fixture.structure.schoolUnitId,
      ]);
      expect(rootSelection.visibleChildren.map((unit) => unit.unitId)).toEqual([
        fixture.structure.schoolUnitId,
      ]);
      expect(rootSelection.effectiveUnitIds).toContain(fixture.structure.cseUnitId);
      expect(rootSelection.effectiveUnitIds).toContain(fixture.structure.eceUnitId);
      expect(rootSelection.effectiveUnitIds).not.toContain(fixture.structure.rootUnitId);

      const rootNode = await getDrillDownNode(fixture.tenant.id, fixture.period.id, {
        unitId: null,
        effectiveUnitIds: rootSelection.effectiveUnitIds,
        visibleChildUnitIds: rootSelection.visibleChildren.map((unit) => unit.unitId),
      });
      expect(rootNode).toBeTruthy();
      expect(rootNode?.unitId).toBeNull();
      expect(rootNode?.totalAllocations).toBe(2);
      expect(rootNode?.childUnitCount).toBe(1);

      const schoolSelection = await resolveDashboardOrgNodeSelection(
        fixture.tenant.id,
        fixture.users.schoolHead.id,
        fixture.structure.schoolUnitId,
      );
      const childStats = await getOrgHierarchyStats(
        fixture.tenant.id,
        fixture.period.id,
        schoolSelection.visibleChildren.map((unit) => unit.unitId),
        schoolSelection.effectiveUnitIds,
      );

      expect(childStats.units.map((unit) => unit.unitId).sort()).toEqual(
        [fixture.structure.cseUnitId, fixture.structure.eceUnitId].sort(),
      );
      expect(childStats.units.every((unit) => unit.navigableChildCount === 0)).toBe(true);
    });
  });

  test("cross-unit comparison keeps child-unit aggregates separated under the selected school node", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker);

      await prisma.orgRoleAssignment.updateMany({
        where: {
          versionId: fixture.structure.versionId,
          userId: fixture.users.schoolHead.id,
          unitId: fixture.structure.schoolUnitId,
        },
        data: { scope: "DESCENDANTS" },
      });

      await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 10,
        notes: uniqueCode("R54_COMPARE_CSE"),
      });
      await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.finalOnly.id,
        assignedToUserId: fixture.users.facultyEce.id,
        targetValue: 14,
        notes: uniqueCode("R54_COMPARE_ECE"),
      });

      const schoolSelection = await resolveDashboardOrgNodeSelection(
        fixture.tenant.id,
        fixture.users.schoolHead.id,
        fixture.structure.schoolUnitId,
      );
      const comparison = await getCrossUnitComparison(
        fixture.tenant.id,
        fixture.period.id,
        schoolSelection.visibleChildren.map((unit) => unit.unitId),
        schoolSelection.effectiveUnitIds,
      );

      expect(comparison.units).toHaveLength(2);
      expect(comparison.units.find((unit) => unit.unitId === fixture.structure.cseUnitId)?.totalAllocations).toBe(1);
      expect(comparison.units.find((unit) => unit.unitId === fixture.structure.eceUnitId)?.totalAllocations).toBe(1);
    });
  });

  test("period comparison stays numeric and counts targets even when some scoped allocations have no achievements", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, {
        periodStateAfterSetup: "IN_PROGRESS",
      });

      const sharedKraTitle = uniqueCode("R54_COMPARE_KRA");
      const sharedKpiTitle = uniqueCode("R54_COMPARE_KPI");
      const sourceSetup = await createEditablePeriodWithKra({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        periodCode: uniqueCode("R54SRC"),
        periodName: "R5.4 Source Period",
        kraTitle: sharedKraTitle,
      });
      const comparisonSetup = await createEditablePeriodWithKra({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        periodCode: uniqueCode("R54CMP"),
        periodName: "R5.4 Comparison Period",
        kraTitle: sharedKraTitle,
      });

      const sourceKpiId = await createMeasuredKpi({
        tenantId: fixture.tenant.id,
        periodId: sourceSetup.period.id,
        kraId: sourceSetup.kra.id,
        actorUserId: fixture.actor.id,
        title: sharedKpiTitle,
        measurementType: "NUMERIC",
        unitLabel: "papers",
        measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
        startingUnitId: fixture.structure.cseUnitId,
        finalUnitId: fixture.structure.cseUnitId,
      });
      const comparisonKpiId = await createMeasuredKpi({
        tenantId: fixture.tenant.id,
        periodId: comparisonSetup.period.id,
        kraId: comparisonSetup.kra.id,
        actorUserId: fixture.actor.id,
        title: sharedKpiTitle,
        measurementType: "NUMERIC",
        unitLabel: "papers",
        measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
        startingUnitId: fixture.structure.cseUnitId,
        finalUnitId: fixture.structure.cseUnitId,
      });

      expect(
        await activateKra(sourceSetup.kra.id, fixture.tenant.id, fixture.actor.id, "TENANT_OWNER"),
      ).toMatchObject({ status: "success" });
      expect(
        await activateKra(
          comparisonSetup.kra.id,
          fixture.tenant.id,
          fixture.actor.id,
          "TENANT_OWNER",
        ),
      ).toMatchObject({ status: "success" });

      const sourceAllocation = await createAllocation(
        fixture.tenant.id,
        {
          periodId: sourceSetup.period.id,
          kpiDefinitionId: sourceKpiId,
          assignedToUserId: fixture.users.facultyCse.id,
          targetValue: 10,
          notes: uniqueCode("R54_SOURCE_TARGET"),
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(sourceAllocation.status).toBe("success");

      const comparisonAllocation = await createAllocation(
        fixture.tenant.id,
        {
          periodId: comparisonSetup.period.id,
          kpiDefinitionId: comparisonKpiId,
          assignedToUserId: fixture.users.facultyCse.id,
          targetValue: 12,
          notes: uniqueCode("R54_COMPARISON_TARGET"),
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(comparisonAllocation.status).toBe("success");

      const comparisonAllocationRecord = await prisma.targetAllocation.findFirstOrThrow({
        where: {
          tenantId: fixture.tenant.id,
          periodId: comparisonSetup.period.id,
          kpiDefinitionId: comparisonKpiId,
          assignedToUserId: fixture.users.facultyCse.id,
        },
        select: { id: true },
      });
      await prisma.assessmentPeriod.update({
        where: { id: comparisonSetup.period.id },
        data: { state: "IN_PROGRESS" },
      });
      const achievement = await recordAchievement(
        fixture.tenant.id,
        {
          periodId: comparisonSetup.period.id,
          kpiDefinitionId: comparisonKpiId,
          targetAllocationId: comparisonAllocationRecord.id,
          actualValue: 9,
          achievementFormData: { description: "Delivered nine outputs." },
        },
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      expect(achievement.status).toBe("success");

      const comparison = await getKpiPeriodComparison(
        fixture.tenant.id,
        sourceKpiId,
        [sourceSetup.period.id, comparisonSetup.period.id],
        [fixture.structure.cseUnitId],
      );

      expect(comparison).toBeTruthy();
      expect(comparison?.comparisonMode).toBe("NUMERIC");
      expect(comparison?.periods[0]?.targetTotal).toBe(10);
      expect(comparison?.periods[0]?.achievedTotal).toBe(0);
      expect(comparison?.periods[1]?.targetTotal).toBe(12);
      expect(comparison?.periods[1]?.achievedTotal).toBe(9);
    });
  });

  test("period comparison downgrades to score-only when the KPI measurement type changes across periods", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, {
        periodStateAfterSetup: "IN_PROGRESS",
      });

      const sharedKraTitle = uniqueCode("R54_DRIFT_KRA");
      const sharedKpiTitle = uniqueCode("R54_DRIFT_KPI");
      const sourceSetup = await createEditablePeriodWithKra({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        periodCode: uniqueCode("R54NUM"),
        periodName: "R5.4 Numeric Period",
        kraTitle: sharedKraTitle,
      });
      const driftSetup = await createEditablePeriodWithKra({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        periodCode: uniqueCode("R54CUR"),
        periodName: "R5.4 Currency Period",
        kraTitle: sharedKraTitle,
      });

      const sourceKpiId = await createMeasuredKpi({
        tenantId: fixture.tenant.id,
        periodId: sourceSetup.period.id,
        kraId: sourceSetup.kra.id,
        actorUserId: fixture.actor.id,
        title: sharedKpiTitle,
        measurementType: "NUMERIC",
        unitLabel: "units",
        measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
        startingUnitId: fixture.structure.cseUnitId,
        finalUnitId: fixture.structure.cseUnitId,
      });
      const driftKpiId = await createMeasuredKpi({
        tenantId: fixture.tenant.id,
        periodId: driftSetup.period.id,
        kraId: driftSetup.kra.id,
        actorUserId: fixture.actor.id,
        title: sharedKpiTitle,
        measurementType: "CURRENCY",
        unitLabel: "INR",
        measurementConfig: { type: "CURRENCY", currencyCode: "INR", decimalPlaces: 0 },
        startingUnitId: fixture.structure.cseUnitId,
        finalUnitId: fixture.structure.cseUnitId,
      });

      expect(
        await activateKra(sourceSetup.kra.id, fixture.tenant.id, fixture.actor.id, "TENANT_OWNER"),
      ).toMatchObject({ status: "success" });
      expect(
        await activateKra(driftSetup.kra.id, fixture.tenant.id, fixture.actor.id, "TENANT_OWNER"),
      ).toMatchObject({ status: "success" });

      const sourceAllocation = await createAllocation(
        fixture.tenant.id,
        {
          periodId: sourceSetup.period.id,
          kpiDefinitionId: sourceKpiId,
          assignedToUserId: fixture.users.facultyCse.id,
          targetValue: 5,
          notes: uniqueCode("R54_DRIFT_SOURCE"),
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(sourceAllocation.status).toBe("success");

      const driftAllocation = await createAllocation(
        fixture.tenant.id,
        {
          periodId: driftSetup.period.id,
          kpiDefinitionId: driftKpiId,
          assignedToUserId: fixture.users.facultyCse.id,
          targetValue: 50000,
          notes: uniqueCode("R54_DRIFT_TARGET"),
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(driftAllocation.status).toBe("success");

      const comparison = await getKpiPeriodComparison(
        fixture.tenant.id,
        sourceKpiId,
        [sourceSetup.period.id, driftSetup.period.id],
        [fixture.structure.cseUnitId],
      );

      expect(comparison).toBeTruthy();
      expect(comparison?.comparisonMode).toBe("SCORE_ONLY");
      expect(comparison?.periods.every((period) => period.targetTotal == null)).toBe(true);
      expect(comparison?.periods.every((period) => period.achievedTotal == null)).toBe(true);
    });
  });
});
