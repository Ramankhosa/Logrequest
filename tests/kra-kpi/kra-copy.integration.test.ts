import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { addTargetUnit, createKpi } from "@/lib/kra-kpi/kpi-service";
import { activateKra, copyKrasFromPeriod, createKra } from "@/lib/kra-kpi/kra-service";
import {
  cleanupTrackedData,
  createTenantActor,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

let tracker: DbTracker;
let tenantId: string;
let actorUserId: string;
const actorRole: Role = "TENANT_ADMIN";

let sourcePeriodId: string;
let targetPeriodId: string;
let startingUnitId: string;
let keyUnitId: string;
let finalUnitId: string;
let targetUnitId: string;

beforeAll(async () => {
  tracker = newDbTracker();
  const tenantActor = await createTenantActor(tracker, actorRole);
  tenantId = tenantActor.tenant.id;
  actorUserId = tenantActor.actor.id;

  const version = await prisma.orgStructureVersion.create({
    data: { tenantId, name: "Copy Test Structure", versionNumber: 1, state: "PUBLISHED" },
  });
  const unitType = await prisma.orgUnitType.create({
    data: {
      versionId: version.id,
      typeKey: "COPY_DEPT",
      internalCategory: "DEPARTMENT_LIKE_UNIT",
      displayLabel: "Department",
    },
  });

  const createUnit = async (code: string, name: string) => (
    prisma.orgUnit.create({
      data: {
        tenantId,
        versionId: version.id,
        typeId: unitType.id,
        code,
        name,
        state: "ACTIVE",
      },
    })
  ).then((unit) => unit.id);

  startingUnitId = await createUnit("IQAC_COPY", "IQAC");
  keyUnitId = await createUnit("DEAN_COPY", "Dean Office");
  finalUnitId = await createUnit("VC_COPY", "Vice Chancellor Office");
  targetUnitId = await createUnit("CS_COPY", "Computer Science");

  await createPeriod(
    tenantId,
    {
      name: "Copy Source Period",
      code: "COPY_SRC_2026",
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      reviewFrequency: "ANNUAL",
    },
    actorUserId,
    actorRole,
  );
  await createPeriod(
    tenantId,
    {
      name: "Copy Target Period",
      code: "COPY_TGT_2027",
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2027-01-01"),
      endDate: new Date("2027-12-31"),
      reviewFrequency: "ANNUAL",
    },
    actorUserId,
    actorRole,
  );

  sourcePeriodId = (
    await prisma.assessmentPeriod.findFirst({
      where: { tenantId, code: "COPY_SRC_2026" },
    })
  )!.id;
  targetPeriodId = (
    await prisma.assessmentPeriod.findFirst({
      where: { tenantId, code: "COPY_TGT_2027" },
    })
  )!.id;

  await createKra(
    tenantId,
    {
      periodId: sourcePeriodId,
      title: "Research Excellence",
      weightage: 60,
      sortOrder: 1,
    },
    actorUserId,
    actorRole,
  );
  await createKra(
    tenantId,
    {
      periodId: sourcePeriodId,
      title: "Teaching Quality",
      weightage: 40,
      sortOrder: 2,
    },
    actorUserId,
    actorRole,
  );

  const sourceResearchKra = await prisma.kraDefinition.findFirstOrThrow({
    where: { tenantId, periodId: sourcePeriodId, title: "Research Excellence" },
  });
  const sourceTeachingKra = await prisma.kraDefinition.findFirstOrThrow({
    where: { tenantId, periodId: sourcePeriodId, title: "Teaching Quality" },
  });

  await createKpi(
    tenantId,
    {
      kraDefinitionId: sourceResearchKra.id,
      title: "Publications",
      description: "Indexed journal publications",
      measurementType: "NUMERIC",
      unitLabel: "papers",
      weightage: 60,
      defaultTarget: 24,
      measurementConfig: { type: "NUMERIC", minValue: 0, maxValue: 100, decimalPlaces: 0 },
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      isPerCapita: true,
      allocationType: "DEPARTMENT",
      startingUnitId,
      achievementTemplateKey: "PUBLICATION",
      achievementFormConfig: {
        templateKey: "PUBLICATION",
        fields: [{ key: "paperTitle", label: "Paper Title", type: "TEXT", required: true, sortOrder: 0 }],
      },
      guidanceNotes: "Use indexed journals only",
      sortOrder: 3,
      keyUnitId,
      finalUnitId,
      sopDescription: "Upload proof and route through review offices.",
      evidenceRequired: true,
      evidenceTypes: ["DOCUMENT", "URL"],
      evidenceInstructions: "Attach journal link and PDF proof.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
    },
    actorUserId,
    actorRole,
  );

  await createKpi(
    tenantId,
    {
      kraDefinitionId: sourceTeachingKra.id,
      title: "Course Feedback",
      measurementType: "PERCENTAGE",
      unitLabel: "%",
      weightage: 40,
      defaultTarget: 90,
      measurementConfig: { type: "PERCENTAGE", minValue: 0, maxValue: 100, decimalPlaces: 1 },
      scoringMethod: "THRESHOLD",
      scoringDirection: "ASCENDING",
      scoringConfig: { method: "THRESHOLD", thresholdValue: 90, belowScore: 70, aboveScore: 100 },
      allocationType: "DEPARTMENT",
      startingUnitId,
      sortOrder: 1,
    },
    actorUserId,
    actorRole,
  );

  const sourceResearchKpi = await prisma.kpiDefinition.findFirstOrThrow({
    where: { kraDefinitionId: sourceResearchKra.id, title: "Publications" },
  });

  await addTargetUnit(
    sourceResearchKpi.id,
    tenantId,
    targetUnitId,
    50,
    "Primary delivery department",
    actorUserId,
    actorRole,
  );

  await activateKra(sourceResearchKra.id, tenantId, actorUserId, actorRole);
});

afterAll(async () => {
  await cleanupTrackedData(tracker);
});

describe("copyKrasFromPeriod", () => {
  it("copies KRAs, KPIs, and target-unit mappings into an empty target period", async () => {
    const result = await copyKrasFromPeriod(
      targetPeriodId,
      tenantId,
      { sourcePeriodId },
      actorUserId,
      actorRole,
    );

    expect(result.status).toBe("success");

    const copiedKras = await prisma.kraDefinition.findMany({
      where: { tenantId, periodId: targetPeriodId },
      include: {
        kpiDefinitions: {
          include: {
            targetUnits: true,
          },
          orderBy: { title: "asc" },
        },
      },
      orderBy: { title: "asc" },
    });

    expect(copiedKras).toHaveLength(2);
    expect(copiedKras.map((kra) => `${kra.title}:${kra.state}`)).toEqual([
      "Research Excellence:ACTIVE",
      "Teaching Quality:DRAFT",
    ]);

    const copiedResearchKra = copiedKras.find((kra) => kra.title === "Research Excellence");
    const copiedResearchKpi = copiedResearchKra?.kpiDefinitions.find((kpi) => kpi.title === "Publications");

    expect(copiedResearchKpi).toBeTruthy();
    expect(copiedResearchKpi?.measurementType).toBe("NUMERIC");
    expect(copiedResearchKpi?.startingUnitId).toBe(startingUnitId);
    expect(copiedResearchKpi?.keyUnitId).toBe(keyUnitId);
    expect(copiedResearchKpi?.finalUnitId).toBe(finalUnitId);
    expect(copiedResearchKpi?.isPerCapita).toBe(true);
    expect(copiedResearchKpi?.isTeamKpi).toBe(true);
    expect(copiedResearchKpi?.teamCreditMethod).toBe("WEIGHTED_SPLIT");
    expect(copiedResearchKpi?.evidenceTypes).toEqual(["DOCUMENT", "URL"]);
    expect(copiedResearchKpi?.targetUnits).toHaveLength(1);
    expect(copiedResearchKpi?.targetUnits[0]).toMatchObject({
      unitId: targetUnitId,
      targetShare: 50,
      notes: "Primary delivery department",
    });

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        targetType: "AssessmentPeriod",
        targetId: targetPeriodId,
        action: "COPY_KRA_KPIS",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(auditLog?.metadata).toMatchObject({
      sourcePeriodId,
      copiedKraCount: 2,
      copiedKpiCount: 2,
      copiedTargetUnitCount: 1,
    });
  });

  it("rejects copying into a period that already has KRAs", async () => {
    const result = await copyKrasFromPeriod(
      targetPeriodId,
      tenantId,
      { sourcePeriodId },
      actorUserId,
      actorRole,
    );

    expect(result.status).toBe("error");
    expect(result.code).toBe("TARGET_PERIOD_NOT_EMPTY");
  });
});
