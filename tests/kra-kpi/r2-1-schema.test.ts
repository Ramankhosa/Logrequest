import {
  EvidenceType,
  KpiFlowStatus,
  TeamCreditMethod,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  cleanupTrackedData,
  createTenantActor,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

let tracker: DbTracker;
let tenantId: string;
let actorUserId: string;
let versionId: string;
let unitTypeId: string;
let unitId: string;
let periodId: string;
let kraId: string;
let kpiId: string;
let allocationId: string;

beforeAll(async () => {
  tracker = newDbTracker();
  const ta = await createTenantActor(tracker, "TENANT_ADMIN");
  tenantId = ta.tenant.id;
  actorUserId = ta.actor.id;

  versionId = (
    await prisma.orgStructureVersion.create({
      data: { tenantId, name: "V1", versionNumber: 1, state: "PUBLISHED" },
    })
  ).id;
  unitTypeId = (
    await prisma.orgUnitType.create({
      data: {
        versionId,
        typeKey: "DEPT",
        internalCategory: "DEPARTMENT_LIKE_UNIT",
        displayLabel: "Dept",
      },
    })
  ).id;
  unitId = (
    await prisma.orgUnit.create({
      data: {
        tenantId,
        versionId,
        typeId: unitTypeId,
        code: "CS_R21_SCHEMA",
        name: "CS Dept",
        state: "ACTIVE",
      },
    })
  ).id;
  periodId = (
    await prisma.assessmentPeriod.create({
      data: {
        tenantId,
        name: "AY2026",
        code: "AY2026_R21S",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
      },
    })
  ).id;
  kraId = (
    await prisma.kraDefinition.create({
      data: { tenantId, periodId, title: "Research R21", weightage: 100, state: "ACTIVE" },
    })
  ).id;
  kpiId = (
    await prisma.kpiDefinition.create({
      data: {
        kraDefinitionId: kraId,
        title: "Pubs R21",
        startingUnitId: unitId,
        state: "ACTIVE",
        weightage: 100,
      },
    })
  ).id;
  allocationId = (
    await prisma.targetAllocation.create({
      data: {
        tenantId,
        periodId,
        kpiDefinitionId: kpiId,
        assignedToUnitId: unitId,
        allocatedByUserId: actorUserId,
        targetValue: 10,
      },
    })
  ).id;
});

afterAll(async () => {
  await cleanupTrackedData(tracker);
});

describe("R2.1 Schema Foundation", () => {
  it("starts with the new R2 tables empty", async () => {
    expect(await prisma.reviewCycle.count({ where: { periodId } })).toBe(0);
    expect(await prisma.kpiTargetUnit.count({ where: { kpiDefinitionId: kpiId } })).toBe(0);
    expect(await prisma.kpiStageDefinition.count({ where: { kpiDefinitionId: kpiId } })).toBe(0);
    expect(await prisma.kpiStageProgress.count({ where: { targetAllocationId: allocationId } })).toBe(0);
  });

  it("exposes the new enum values", () => {
    expect(Object.values(KpiFlowStatus)).toEqual([
      "CREATED",
      "ASSIGNED",
      "IN_PROGRESS",
      "SUBMITTED",
      "KEY_REVIEW",
      "KEY_APPROVED",
      "KEY_REJECTED",
      "FINAL_REVIEW",
      "VERIFIED",
      "REJECTED",
    ]);
    expect(Object.values(EvidenceType)).toEqual([
      "DOCUMENT",
      "URL",
      "CERTIFICATE",
      "SELF_DECLARATION",
      "SYSTEM_GENERATED",
      "NONE",
    ]);
    expect(Object.values(TeamCreditMethod)).toEqual([
      "FULL_EACH",
      "EQUAL_SPLIT",
      "WEIGHTED_SPLIT",
      "PRIMARY_ONLY",
    ]);
  });

  it("applies the expected defaults on TargetAllocation and KpiDefinition", async () => {
    const allocation = await prisma.targetAllocation.findUniqueOrThrow({
      where: { id: allocationId },
    });
    const kpi = await prisma.kpiDefinition.findUniqueOrThrow({
      where: { id: kpiId },
    });

    expect(allocation.flowStatus).toBe("CREATED");
    expect(allocation.flowLog).toBeNull();
    expect(allocation.verifierOverrideUserId).toBeNull();
    expect(allocation.teamWeights).toBeNull();

    expect(kpi.keyUnitId).toBeNull();
    expect(kpi.finalUnitId).toBeNull();
    expect(kpi.sopDescription).toBeNull();
    expect(kpi.evidenceRequired).toBe(true);
    expect(kpi.evidenceTypes).toEqual([]);
    expect(kpi.evidenceInstructions).toBeNull();
    expect(kpi.isTeamKpi).toBe(false);
    expect(kpi.teamCreditMethod).toBe("FULL_EACH");
  });

  it("applies the expected defaults on Achievement", async () => {
    const achievement = await prisma.achievement.create({
      data: {
        tenantId,
        kpiDefinitionId: kpiId,
        reportedByUserId: actorUserId,
        periodId,
      },
    });

    expect(achievement.evidenceFiles).toBeNull();
    expect(achievement.currentVerifierUserId).toBeNull();
    expect(achievement.currentVerifierUnitId).toBeNull();
    expect(achievement.isTeamAchievement).toBe(false);
  });

  it("enforces unique constraints for target units, stages, stage progress, and review cycles", async () => {
    const targetUnit = await prisma.kpiTargetUnit.create({
      data: { kpiDefinitionId: kpiId, unitId, targetShare: 50 },
    });
    await expect(
      prisma.kpiTargetUnit.create({
        data: { kpiDefinitionId: kpiId, unitId },
      }),
    ).rejects.toThrow();
    await prisma.kpiTargetUnit.delete({ where: { id: targetUnit.id } });

    const stage = await prisma.kpiStageDefinition.create({
      data: { kpiDefinitionId: kpiId, stageOrder: 1, title: "Literature Review" },
    });
    await expect(
      prisma.kpiStageDefinition.create({
        data: { kpiDefinitionId: kpiId, stageOrder: 1, title: "Duplicate" },
      }),
    ).rejects.toThrow();

    const achievement = await prisma.achievement.create({
      data: {
        tenantId,
        periodId,
        kpiDefinitionId: kpiId,
        targetAllocationId: allocationId,
        reportedByUserId: actorUserId,
      },
    });
    const progress = await prisma.kpiStageProgress.create({
      data: {
        targetAllocationId: allocationId,
        stageDefinitionId: stage.id,
        achievementId: achievement.id,
      },
    });
    await expect(
      prisma.kpiStageProgress.create({
        data: {
          targetAllocationId: allocationId,
          stageDefinitionId: stage.id,
          achievementId: achievement.id,
        },
      }),
    ).rejects.toThrow();
    await prisma.kpiStageProgress.delete({ where: { id: progress.id } });
    await prisma.achievement.delete({ where: { id: achievement.id } });
    await prisma.kpiStageDefinition.delete({ where: { id: stage.id } });

    const cycle = await prisma.reviewCycle.create({
      data: {
        periodId,
        cycleNumber: 1,
        label: "Q1",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-03-31"),
      },
    });
    await expect(
      prisma.reviewCycle.create({
        data: {
          periodId,
          cycleNumber: 1,
          label: "Duplicate Q1",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-03-31"),
        },
      }),
    ).rejects.toThrow();
    await prisma.reviewCycle.delete({ where: { id: cycle.id } });
  });

  it("cascades deletes from KpiDefinition to target units, stages, and stage progress", async () => {
    const cascadeKpi = await prisma.kpiDefinition.create({
      data: {
        kraDefinitionId: kraId,
        title: "Cascade KPI",
        startingUnitId: unitId,
        state: "ACTIVE",
        weightage: 0,
      },
    });
    const targetUnit = await prisma.kpiTargetUnit.create({
      data: { kpiDefinitionId: cascadeKpi.id, unitId },
    });
    const stage = await prisma.kpiStageDefinition.create({
      data: { kpiDefinitionId: cascadeKpi.id, stageOrder: 1, title: "Stage 1" },
    });
    const progress = await prisma.kpiStageProgress.create({
      data: { targetAllocationId: allocationId, stageDefinitionId: stage.id },
    });

    await prisma.kpiDefinition.delete({ where: { id: cascadeKpi.id } });

    expect(await prisma.kpiTargetUnit.findUnique({ where: { id: targetUnit.id } })).toBeNull();
    expect(await prisma.kpiStageDefinition.findUnique({ where: { id: stage.id } })).toBeNull();
    expect(await prisma.kpiStageProgress.findUnique({ where: { id: progress.id } })).toBeNull();
  });

  it("cascades deletes from AssessmentPeriod to ReviewCycle", async () => {
    const disposablePeriod = await prisma.assessmentPeriod.create({
      data: {
        tenantId,
        name: "Disposable Period",
        code: "DISPOSABLE_R21_PERIOD",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
      },
    });
    const cycles = await prisma.reviewCycle.createMany({
      data: [
        {
          periodId: disposablePeriod.id,
          cycleNumber: 1,
          label: "Q1",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-03-31"),
        },
        {
          periodId: disposablePeriod.id,
          cycleNumber: 2,
          label: "Q2",
          startDate: new Date("2026-04-01"),
          endDate: new Date("2026-06-30"),
        },
      ],
    });
    expect(cycles.count).toBe(2);

    await prisma.assessmentPeriod.delete({ where: { id: disposablePeriod.id } });
    expect(await prisma.reviewCycle.count({ where: { periodId: disposablePeriod.id } })).toBe(0);
  });

  it("sets keyUnitId and finalUnitId to null when the referenced org unit is deleted", async () => {
    const secondaryUnit = await prisma.orgUnit.create({
      data: {
        tenantId,
        versionId,
        typeId: unitTypeId,
        code: `R21_KEY_${Date.now()}`,
        name: "Key Unit",
        state: "ACTIVE",
      },
    });
    const finalUnit = await prisma.orgUnit.create({
      data: {
        tenantId,
        versionId,
        typeId: unitTypeId,
        code: `R21_FINAL_${Date.now()}`,
        name: "Final Unit",
        state: "ACTIVE",
      },
    });
    const setNullKpi = await prisma.kpiDefinition.create({
      data: {
        kraDefinitionId: kraId,
        title: "Set Null KPI",
        startingUnitId: unitId,
        keyUnitId: secondaryUnit.id,
        finalUnitId: finalUnit.id,
        state: "ACTIVE",
        weightage: 0,
      },
    });

    await prisma.orgUnit.delete({ where: { id: secondaryUnit.id } });
    await prisma.orgUnit.delete({ where: { id: finalUnit.id } });

    const refreshed = await prisma.kpiDefinition.findUniqueOrThrow({
      where: { id: setNullKpi.id },
    });
    expect(refreshed.keyUnitId).toBeNull();
    expect(refreshed.finalUnitId).toBeNull();
  });

  it("rejects negative ReviewCycle cycleNumber values via DB constraint", async () => {
    await expect(
      prisma.reviewCycle.create({
        data: {
          periodId,
          cycleNumber: -1,
          label: "Invalid",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-01-01"),
        },
      }),
    ).rejects.toThrow();
  });
});
