import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createKpi,
  addTargetUnit,
  removeTargetUnit,
  listTargetUnits,
  updateTargetUnit,
} from "@/lib/kra-kpi/kpi-service";
import { createPeriod, transitionPeriodState } from "@/lib/kra-kpi/period-service";
import { createKra, activateKra } from "@/lib/kra-kpi/kra-service";
import { allocateToTargetUnits } from "@/lib/kra-kpi/target-service";
import {
  cleanupTrackedData,
  createTenantActor,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

let tracker: DbTracker;
let tenantId: string;
let actorUserId: string;
let foreignTenantId: string;
let foreignActorUserId: string;
const actorRole: Role = "TENANT_ADMIN";
let periodId: string;
let kraId: string;
let kpiId: string;
let noTargetKpiId: string;
let roundingKpiId: string;
let smallRoundingKpiId: string;
let percentageKpiId: string;
let booleanKpiId: string;
let archivedKpiId: string;
let unitAId: string;
let unitBId: string;
let unitCId: string;
let startingUnitId: string;
let foreignUnitId: string;

beforeAll(async () => {
  tracker = newDbTracker();
  const ta = await createTenantActor(tracker, actorRole);
  tenantId = ta.tenant.id;
  actorUserId = ta.actor.id;
  const foreignTa = await createTenantActor(tracker, actorRole);
  foreignTenantId = foreignTa.tenant.id;
  foreignActorUserId = foreignTa.actor.id;

  // Setup structure
  const version = await prisma.orgStructureVersion.create({
    data: { tenantId, name: "V1", versionNumber: 1, state: "PUBLISHED" },
  });
  const unitType = await prisma.orgUnitType.create({
    data: { versionId: version.id, typeKey: "DEPT_TU", internalCategory: "DEPARTMENT_LIKE_UNIT", displayLabel: "Dept" },
  });

  const createUnit = async (code: string, name: string) => {
    const unit = await prisma.orgUnit.create({
      data: { tenantId, versionId: version.id, typeId: unitType.id, code, name, state: "ACTIVE" },
    });
    return unit.id;
  };

  startingUnitId = await createUnit("IQAC_TU", "IQAC");
  unitAId = await createUnit("CS_TU", "Computer Science");
  unitBId = await createUnit("ME_TU", "Mechanical Engg");
  unitCId = await createUnit("EE_TU", "Electrical Engg");

  const foreignVersion = await prisma.orgStructureVersion.create({
    data: { tenantId: foreignTenantId, name: "FV1", versionNumber: 1, state: "PUBLISHED" },
  });
  const foreignUnitType = await prisma.orgUnitType.create({
    data: {
      versionId: foreignVersion.id,
      typeKey: "DEPT_FTU",
      internalCategory: "DEPARTMENT_LIKE_UNIT",
      displayLabel: "Dept",
    },
  });
  foreignUnitId = (
    await prisma.orgUnit.create({
      data: {
        tenantId: foreignTenantId,
        versionId: foreignVersion.id,
        typeId: foreignUnitType.id,
        code: "FOR_TU",
        name: "Foreign Unit",
        state: "ACTIVE",
      },
    })
  ).id;

  // Setup period
  await createPeriod(tenantId, {
    name: "TU Test Period",
    code: "TU_TEST_2026",
    periodType: "SPECIFIC_RANGE",
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-12-31"),
    reviewFrequency: "ANNUAL",
  }, actorUserId, actorRole);
  const period = await prisma.assessmentPeriod.findFirst({ where: { tenantId, code: "TU_TEST_2026" } });
  periodId = period!.id;

  await transitionPeriodState(periodId, tenantId, "OPEN", actorUserId, actorRole);

  // Setup KRA + KPI (create KPI before activating KRA, since activateKra requires KPIs)
  await createKra(tenantId, {
    periodId, title: "Research TU", weightage: 100, categoryId: undefined,
  }, actorUserId, actorRole);
  const kra = await prisma.kraDefinition.findFirst({ where: { tenantId, periodId, title: "Research TU" } });
  kraId = kra!.id;

  await createKpi(tenantId, {
    kraDefinitionId: kraId,
    title: "Publications TU",
    measurementType: "NUMERIC",
    weightage: 80,
    startingUnitId,
    defaultTarget: 100,
    allocationType: "DEPARTMENT",
  }, actorUserId, actorRole);
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { kraDefinitionId: kraId, title: "Publications TU" },
  });
  kpiId = kpi!.id;

  await createKpi(tenantId, {
    kraDefinitionId: kraId,
    title: "No Targets KPI",
    measurementType: "BOOLEAN",
    weightage: 20,
    startingUnitId,
  }, actorUserId, actorRole);
  const noTargetKpi = await prisma.kpiDefinition.findFirst({
    where: { kraDefinitionId: kraId, title: "No Targets KPI" },
  });
  noTargetKpiId = noTargetKpi!.id;

  await createKpi(tenantId, {
    kraDefinitionId: kraId,
    title: "Rounding KPI",
    measurementType: "NUMERIC",
    weightage: 0,
    startingUnitId,
    defaultTarget: 100,
    allocationType: "DEPARTMENT",
  }, actorUserId, actorRole);
  roundingKpiId = (
    await prisma.kpiDefinition.findFirst({
      where: { kraDefinitionId: kraId, title: "Rounding KPI" },
    })
  )!.id;

  await createKpi(tenantId, {
    kraDefinitionId: kraId,
    title: "Small Rounding KPI",
    measurementType: "NUMERIC",
    weightage: 0,
    startingUnitId,
    defaultTarget: 10,
    allocationType: "DEPARTMENT",
  }, actorUserId, actorRole);
  smallRoundingKpiId = (
    await prisma.kpiDefinition.findFirst({
      where: { kraDefinitionId: kraId, title: "Small Rounding KPI" },
    })
  )!.id;

  await createKpi(tenantId, {
    kraDefinitionId: kraId,
    title: "Percentage KPI",
    measurementType: "PERCENTAGE",
    weightage: 0,
    startingUnitId,
    defaultTarget: 90,
    allocationType: "DEPARTMENT",
  }, actorUserId, actorRole);
  percentageKpiId = (
    await prisma.kpiDefinition.findFirst({
      where: { kraDefinitionId: kraId, title: "Percentage KPI" },
    })
  )!.id;

  await createKpi(tenantId, {
    kraDefinitionId: kraId,
    title: "Boolean KPI",
    measurementType: "BOOLEAN",
    weightage: 0,
    startingUnitId,
    allocationType: "DEPARTMENT",
  }, actorUserId, actorRole);
  booleanKpiId = (
    await prisma.kpiDefinition.findFirst({
      where: { kraDefinitionId: kraId, title: "Boolean KPI" },
    })
  )!.id;

  await createKpi(tenantId, {
    kraDefinitionId: kraId,
    title: "Archived KPI",
    measurementType: "NUMERIC",
    weightage: 0,
    startingUnitId,
    defaultTarget: 10,
    allocationType: "DEPARTMENT",
  }, actorUserId, actorRole);
  archivedKpiId = (
    await prisma.kpiDefinition.findFirst({
      where: { kraDefinitionId: kraId, title: "Archived KPI" },
    })
  )!.id;

  await activateKra(kraId, tenantId, actorUserId, actorRole);
  await prisma.kpiDefinition.update({
    where: { id: archivedKpiId },
    data: { state: "ARCHIVED" },
  });
});

afterAll(async () => {
  await cleanupTrackedData(tracker);
});

describe("R2.1 Multi-Target Units", () => {
  describe("addTargetUnit", () => {
    it("adds unit to KPI successfully", async () => {
      const result = await addTargetUnit(kpiId, tenantId, unitAId, 33, null, actorUserId, actorRole);
      expect(result.status).toBe("success");
    });

    it("rejects duplicate unit", async () => {
      const result = await addTargetUnit(kpiId, tenantId, unitAId, 25, null, actorUserId, actorRole);
      expect(result.status).toBe("error");
    });

    it("rejects starting unit as target", async () => {
      const result = await addTargetUnit(kpiId, tenantId, startingUnitId, 25, null, actorUserId, actorRole);
      expect(result.status).toBe("error");
    });

    it("rejects target unit from another tenant", async () => {
      const result = await addTargetUnit(kpiId, tenantId, foreignUnitId, 25, null, actorUserId, actorRole);
      expect(result.status).toBe("error");
      expect(result.code).toBe("UNIT_NOT_FOUND");
    });

    it("rejects archived KPI", async () => {
      const result = await addTargetUnit(archivedKpiId, tenantId, unitBId, 25, null, actorUserId, actorRole);
      expect(result.status).toBe("error");
      expect(result.code).toBe("KPI_ARCHIVED");
    });

    it("rejects non-admin", async () => {
      const result = await addTargetUnit(kpiId, tenantId, unitBId, 25, null, actorUserId, "TENANT_USER");
      expect(result.status).toBe("error");
    });

    it("rejects targetShare > 100", async () => {
      const result = await addTargetUnit(kpiId, tenantId, unitBId, 150, null, actorUserId, actorRole);
      expect(result.status).toBe("error");
    });

    it("rejects targetShare <= 0", async () => {
      const result = await addTargetUnit(kpiId, tenantId, unitBId, 0, null, actorUserId, actorRole);
      expect(result.status).toBe("error");
    });

    it("adds second and third units successfully", async () => {
      let result = await addTargetUnit(kpiId, tenantId, unitBId, 33, null, actorUserId, actorRole);
      expect(result.status).toBe("success");
      result = await addTargetUnit(kpiId, tenantId, unitCId, 34, null, actorUserId, actorRole);
      expect(result.status).toBe("success");
    });
  });

  describe("listTargetUnits", () => {
    it("returns all 3 target units with unit details", async () => {
      const units = await listTargetUnits(kpiId, tenantId);
      expect(units).toHaveLength(3);
      expect(units.map((u) => u.unitName).sort()).toEqual(["Computer Science", "Electrical Engg", "Mechanical Engg"]);
    });

    it("returns empty for KPI with no target units", async () => {
      const units = await listTargetUnits("nonexistent-kpi", tenantId);
      expect(units).toHaveLength(0);
    });
  });

  describe("updateTargetUnit", () => {
    it("updates share", async () => {
      const result = await updateTargetUnit(kpiId, tenantId, unitAId, 50, "Updated", actorUserId, actorRole);
      expect(result.status).toBe("success");

      const units = await listTargetUnits(kpiId, tenantId);
      const updated = units.find((u) => u.unitId === unitAId);
      expect(updated!.targetShare).toBe(50);
      expect(updated!.notes).toBe("Updated");
    });

    it("rejects cross-tenant updates", async () => {
      const result = await updateTargetUnit(
        kpiId,
        foreignTenantId,
        unitAId,
        40,
        "cross-tenant",
        foreignActorUserId,
        actorRole,
      );
      expect(result.status).toBe("error");
      expect(result.code).toBe("KPI_NOT_FOUND");
    });
  });

  describe("removeTargetUnit", () => {
    it("removes unit with no allocations", async () => {
      const result = await removeTargetUnit(kpiId, tenantId, unitCId, actorUserId, actorRole);
      expect(result.status).toBe("success");

      const units = await listTargetUnits(kpiId, tenantId);
      expect(units).toHaveLength(2);
    });

    it("re-add for allocation test", async () => {
      const result = await addTargetUnit(kpiId, tenantId, unitCId, 25, null, actorUserId, actorRole);
      expect(result.status).toBe("success");
    });

    it("rejects cross-tenant removals", async () => {
      const result = await removeTargetUnit(
        kpiId,
        foreignTenantId,
        unitBId,
        foreignActorUserId,
        actorRole,
      );
      expect(result.status).toBe("error");
      expect(result.code).toBe("KPI_NOT_FOUND");
    });
  });

  describe("allocateToTargetUnits", () => {
    it("creates allocations for all target units", async () => {
      await transitionPeriodState(periodId, tenantId, "IN_PROGRESS", actorUserId, actorRole);

      const result = await allocateToTargetUnits(
        kpiId,
        periodId,
        tenantId,
        { targetValue: 100 },
        actorUserId,
        actorRole
      );
      expect(result.status).toBe("success");

      const allocations = await prisma.targetAllocation.findMany({
        where: { kpiDefinitionId: kpiId, periodId, tenantId },
      });
      expect(allocations.length).toBe(3);

      const summaryAudit = await prisma.auditLog.findFirst({
        where: {
          tenantId,
          targetType: "KpiTargetUnitAllocation",
          targetId: `${kpiId}:${periodId}`,
          action: "ALLOCATE_TO_TARGET_UNITS",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(summaryAudit?.metadata).toMatchObject({ createdCount: 3, skippedCount: 0 });
    });

    it("skips already-allocated units on second call", async () => {
      const result = await allocateToTargetUnits(
        kpiId,
        periodId,
        tenantId,
        { targetValue: 100 },
        actorUserId,
        actorRole
      );
      expect(result.status).toBe("success");
      expect(result.message).toContain("already");
    });

    it("splits numeric targets exactly when 100 is divided across 3 units", async () => {
      await addTargetUnit(roundingKpiId, tenantId, unitAId, 33.33, null, actorUserId, actorRole);
      await addTargetUnit(roundingKpiId, tenantId, unitBId, 33.33, null, actorUserId, actorRole);
      await addTargetUnit(roundingKpiId, tenantId, unitCId, 33.34, null, actorUserId, actorRole);

      const result = await allocateToTargetUnits(
        roundingKpiId,
        periodId,
        tenantId,
        { targetValue: 100 },
        actorUserId,
        actorRole
      );
      expect(result.status).toBe("success");

      const allocations = await prisma.targetAllocation.findMany({
        where: { kpiDefinitionId: roundingKpiId, periodId, tenantId },
        orderBy: { assignedToUnitId: "asc" },
      });
      const values = allocations.map((allocation) => allocation.targetValue ?? 0).sort((a, b) => a - b);
      expect(values).toEqual([33, 33, 34]);
      expect(values.reduce((sum, value) => sum + value, 0)).toBe(100);
    });

    it("splits numeric targets exactly when 10 is divided across 3 units", async () => {
      await addTargetUnit(smallRoundingKpiId, tenantId, unitAId, null, null, actorUserId, actorRole);
      await addTargetUnit(smallRoundingKpiId, tenantId, unitBId, null, null, actorUserId, actorRole);
      await addTargetUnit(smallRoundingKpiId, tenantId, unitCId, null, null, actorUserId, actorRole);

      const result = await allocateToTargetUnits(
        smallRoundingKpiId,
        periodId,
        tenantId,
        { targetValue: 10 },
        actorUserId,
        actorRole
      );
      expect(result.status).toBe("success");

      const allocations = await prisma.targetAllocation.findMany({
        where: { kpiDefinitionId: smallRoundingKpiId, periodId, tenantId },
        orderBy: { assignedToUnitId: "asc" },
      });
      const values = allocations.map((allocation) => allocation.targetValue ?? 0).sort((a, b) => a - b);
      expect(values).toEqual([3, 3, 4]);
      expect(values.reduce((sum, value) => sum + value, 0)).toBe(10);
    });

    it("replicates percentage targets instead of summing them", async () => {
      await addTargetUnit(percentageKpiId, tenantId, unitAId, null, null, actorUserId, actorRole);
      await addTargetUnit(percentageKpiId, tenantId, unitBId, null, null, actorUserId, actorRole);
      await addTargetUnit(percentageKpiId, tenantId, unitCId, null, null, actorUserId, actorRole);

      const result = await allocateToTargetUnits(
        percentageKpiId,
        periodId,
        tenantId,
        { targetValue: 90 },
        actorUserId,
        actorRole
      );
      expect(result.status).toBe("success");

      const allocations = await prisma.targetAllocation.findMany({
        where: { kpiDefinitionId: percentageKpiId, periodId, tenantId },
      });
      expect(allocations).toHaveLength(3);
      expect(allocations.every((allocation) => allocation.targetValue === 90)).toBe(true);
    });

    it("replicates boolean targets", async () => {
      await addTargetUnit(booleanKpiId, tenantId, unitAId, null, null, actorUserId, actorRole);
      await addTargetUnit(booleanKpiId, tenantId, unitBId, null, null, actorUserId, actorRole);
      await addTargetUnit(booleanKpiId, tenantId, unitCId, null, null, actorUserId, actorRole);

      const result = await allocateToTargetUnits(
        booleanKpiId,
        periodId,
        tenantId,
        { targetBoolean: true },
        actorUserId,
        actorRole
      );
      expect(result.status).toBe("success");

      const allocations = await prisma.targetAllocation.findMany({
        where: { kpiDefinitionId: booleanKpiId, periodId, tenantId },
      });
      expect(allocations).toHaveLength(3);
      expect(allocations.every((allocation) => allocation.targetBoolean === true)).toBe(true);
    });

    it("returns error for KPI without target units", async () => {
      const result = await allocateToTargetUnits(
        noTargetKpiId,
        periodId,
        tenantId,
        { targetBoolean: true },
        actorUserId,
        actorRole
      );
      expect(result.status).toBe("error");
      expect(result.message).toContain("No target units");
    });

    it("removeTargetUnit fails when allocations exist", async () => {
      const result = await removeTargetUnit(kpiId, tenantId, unitAId, actorUserId, actorRole);
      expect(result.status).toBe("error");
      expect(result.message).toContain("allocations");
      expect(result.code).toBe("TARGET_UNIT_HAS_ALLOCATIONS");
    });
  });
});
