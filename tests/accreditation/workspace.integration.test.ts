import {
  AssessmentWorkspaceStatus,
  CriterionDataType,
  CriterionEntryStatus,
  CriterionYearAggregation,
  TenantServiceCode,
  WorkspaceCollaboratorRole,
} from "@prisma/client";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createTenantAccreditationBody,
  createTenantBodyVersion,
  createTenantVersionCriterion,
  createTenantVersionProfile,
} from "@/lib/accreditation/service";
import {
  addAssessmentWorkspaceCollaborator,
  addAssessmentWorkspaceEvidenceVersion,
  addAssessmentWorkspaceMilestone,
  addAssessmentWorkspaceDiscussionMessage,
  approveAssessmentWorkspaceSectionReview,
  applyAssessmentWorkspaceReuse,
  bulkAssignAssessmentWorkspaceSections,
  checkAssessmentWorkspaceDrift,
  checkAssessmentWorkspaceReadiness,
  cloneAssessmentWorkspace,
  compareAssessmentWorkspaceSnapshots,
  confirmAssessmentWorkspaceSectionReview,
  computeAssessmentWorkspaceScores,
  createAssessmentWorkspace,
  createAssessmentWorkspaceDiscussionThread,
  createAssessmentWorkspaceEvidence,
  deleteAssessmentWorkspaceEvidence,
  deleteAssessmentWorkspaceEvidenceVersion,
  freezeAssessmentWorkspace,
  getAssessmentWorkspaceActivitySinceLastVisit,
  getAssessmentWorkspaceDataGaps,
  getAssessmentWorkspaceSubmissionManifest,
  getAssessmentWorkspace,
  importAssessmentWorkspaceData,
  initializeAssessmentWorkspaceEntries,
  listCriterionEntryChangeLog,
  listAssessmentWorkspaceEntries,
  listAssessmentWorkspaceSections,
  listAssessmentWorkspaceSnapshots,
  previewAssessmentWorkspaceReuse,
  reassignAssessmentWorkspaceSection,
  removeAssessmentWorkspaceCollaborator,
  requestChangesAssessmentWorkspaceSectionReview,
  setCriterionEntryManualOverride,
  setCriterionEntryYearData,
  submitAssessmentWorkspaceSectionReview,
  takeAssessmentWorkspaceSnapshot,
  unfreezeAssessmentWorkspace,
  updateAssessmentWorkspaceStatus,
  updateAssessmentWorkspaceMilestone,
  updateCriterionEntryStatus,
  linkAssessmentWorkspaceEvidence,
} from "@/lib/accreditation/workspace-service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
  enableTenantService,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

type CriterionSpec = {
  criterionCode: string;
  title: string;
  dataType?: CriterionDataType;
  maxScore?: number | null;
  expectedEvidence?: unknown;
  validationRules?: unknown;
  yearAggregation?: CriterionYearAggregation;
  yearAggregationConfig?: unknown;
};

async function createEnabledTenantAccreditationContext(tracker: DbTracker) {
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");

  await enableTenantService({
    tenantId: tenant.id,
    serviceCode: TenantServiceCode.ACCREDITATION,
    actorUserId: actor.id,
  });

  const bodyResult = await createTenantAccreditationBody(
    tenant.id,
    {
      code: `TACC_${Date.now()}`,
      name: "Tenant Accreditation Framework",
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(bodyResult).toMatchObject({ status: "success" });
  if (bodyResult.status !== "success") {
    throw new Error(bodyResult.message);
  }

  const versionResult = await createTenantBodyVersion(
    tenant.id,
    bodyResult.body.id,
    {
      versionCode: `2026_${Date.now()}`,
      versionName: "Tenant Framework 2026",
      scoreBase: 100,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(versionResult).toMatchObject({ status: "success" });
  if (versionResult.status !== "success") {
    throw new Error(versionResult.message);
  }

  const profileResult = await createTenantVersionProfile(
    tenant.id,
    versionResult.version.id,
    {
      profileCode: "UNIVERSITY",
      profileName: "University",
      isDefault: true,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(profileResult).toMatchObject({ status: "success" });
  if (profileResult.status !== "success") {
    throw new Error(profileResult.message);
  }

  return {
    tenant,
    actor,
    body: bodyResult.body,
    version: versionResult.version,
    profile: profileResult.profile,
  };
}

async function createWorkspaceFixture(input: {
  tracker: DbTracker;
  criteria: CriterionSpec[];
  title?: string;
  periodStart?: Date;
  periodEnd?: Date;
}) {
  const context = await createEnabledTenantAccreditationContext(input.tracker);
  const criteriaByCode = new Map<string, { id: string; title: string }>();

  for (const criterionSpec of input.criteria) {
    const criterionResult = await createTenantVersionCriterion(
      context.tenant.id,
      context.version.id,
      {
        criterionCode: criterionSpec.criterionCode,
        title: criterionSpec.title,
        dataType: criterionSpec.dataType ?? CriterionDataType.QUANTITATIVE,
        maxScore: criterionSpec.maxScore ?? 100,
        expectedEvidence: criterionSpec.expectedEvidence,
        validationRules: criterionSpec.validationRules,
        isLeaf: true,
        sortOrder: criteriaByCode.size,
      },
      context.actor.id,
      "TENANT_OWNER",
    );
    expect(criterionResult).toMatchObject({ status: "success" });
    if (criterionResult.status !== "success") {
      throw new Error(criterionResult.message);
    }

    if (criterionSpec.yearAggregation || criterionSpec.yearAggregationConfig) {
      await prisma.accreditationCriterion.update({
        where: { id: criterionResult.criterion.id },
        data: {
          ...(criterionSpec.yearAggregation
            ? { yearAggregation: criterionSpec.yearAggregation }
            : {}),
          ...(criterionSpec.yearAggregationConfig !== undefined
            ? { yearAggregationConfig: criterionSpec.yearAggregationConfig as never }
            : {}),
        },
      });
    }

    criteriaByCode.set(criterionSpec.criterionCode, {
      id: criterionResult.criterion.id,
      title: criterionSpec.title,
    });
  }

  const workspaceResult = await createAssessmentWorkspace(
    context.tenant.id,
    {
      versionId: context.version.id,
      profileId: context.profile.id,
      title: input.title ?? "Assessment Workspace",
      periodStart: input.periodStart ?? new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: input.periodEnd ?? new Date("2026-12-31T00:00:00.000Z"),
      targetGrade: "A++",
    },
    context.actor.id,
    "TENANT_OWNER",
  );
  expect(workspaceResult).toMatchObject({ status: "success" });
  if (workspaceResult.status !== "success") {
    throw new Error(workspaceResult.message);
  }

  const workspaceId = (workspaceResult.workspace as { id: string }).id;
  const entryRows = await prisma.criterionEntry.findMany({
    where: { workspaceId },
    include: {
      criterion: {
        select: {
          criterionCode: true,
        },
      },
      yearData: {
        orderBy: { year: "asc" },
      },
    },
  });
  const entriesByCode = new Map(entryRows.map((entry) => [entry.criterion.criterionCode, entry]));

  return {
    ...context,
    workspaceId,
    initialized: workspaceResult.initialized,
    criteriaByCode,
    entriesByCode,
  };
}

async function createWorkspaceCollaborator(input: {
  tracker: DbTracker;
  tenantId: string;
  workspaceId: string;
  actorUserId: string;
  firstName: string;
  lastName: string;
  role: WorkspaceCollaboratorRole;
  assignedSections?: string[];
}) {
  const user = await createTestUser(input.tracker, {
    firstName: input.firstName,
    lastName: input.lastName,
  });

  await createTestMembership({
    tenantId: input.tenantId,
    userId: user.id,
    role: "TENANT_USER",
    createdByUserId: input.actorUserId,
  });

  const collaborator = await addAssessmentWorkspaceCollaborator(
    input.workspaceId,
    input.tenantId,
    {
      userId: user.id,
      role: input.role,
      assignedSections: input.assignedSections ?? [],
    },
    input.actorUserId,
    "TENANT_OWNER",
  );
  expect(collaborator).toMatchObject({ status: "success" });
  if (collaborator.status !== "success") {
    throw new Error(collaborator.message);
  }

  return { user, collaborator: collaborator.collaborator };
}

describe("accreditation workspace core filing", () => {
  test("workspace creation locks the version and entry initialization is idempotent", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        title: "NAAC Cycle 4",
        criteria: [
          {
            criterionCode: "CR1",
            title: "Research Output",
            maxScore: 40,
          },
          {
            criterionCode: "CR2",
            title: "Quality Initiatives",
            dataType: CriterionDataType.QUALITATIVE,
            maxScore: 60,
          },
        ],
      });

      expect(fixture.initialized).toEqual({
        created: 2,
        alreadyExisted: 0,
      });

      const version = await prisma.accreditationBodyVersion.findUniqueOrThrow({
        where: { id: fixture.version.id },
        select: { isLocked: true },
      });
      expect(version.isLocked).toBe(true);

      const rerun = await initializeAssessmentWorkspaceEntries(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(rerun).toMatchObject({ status: "success" });
      if (rerun.status !== "success") {
        throw new Error(rerun.message);
      }
      expect(rerun.initialized).toEqual({
        created: 0,
        alreadyExisted: 2,
      });

      const archive = await updateAssessmentWorkspaceStatus(
        fixture.workspaceId,
        fixture.tenant.id,
        { status: AssessmentWorkspaceStatus.ARCHIVED },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(archive).toMatchObject({ status: "success" });

      const workspace = await prisma.assessmentWorkspace.findUniqueOrThrow({
        where: { id: fixture.workspaceId },
        select: { status: true },
      });
      expect(workspace.status).toBe(AssessmentWorkspaceStatus.ARCHIVED);
    });
  });

  test("year data validates period and qualitative text, and optimistic locking protects concurrent edits", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        criteria: [
          {
            criterionCode: "CR1",
            title: "Research Output",
            maxScore: 40,
          },
          {
            criterionCode: "CR2",
            title: "Quality Initiatives",
            dataType: CriterionDataType.QUALITATIVE,
            validationRules: { maxLength: 1000 },
          },
        ],
      });

      const quantitativeEntry = fixture.entriesByCode.get("CR1");
      const qualitativeEntry = fixture.entriesByCode.get("CR2");
      expect(quantitativeEntry).toBeDefined();
      expect(qualitativeEntry).toBeDefined();
      if (!quantitativeEntry || !qualitativeEntry) {
        throw new Error("Expected workspace entries were not created.");
      }

      const outOfRange = await setCriterionEntryYearData(
        quantitativeEntry.id,
        fixture.tenant.id,
        {
          year: 2040,
          numericValue: 25,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(outOfRange).toMatchObject({ status: "error" });
      expect(outOfRange.message).toContain("outside the workspace period");

      const missingNarrative = await setCriterionEntryYearData(
        qualitativeEntry.id,
        fixture.tenant.id,
        {
          year: 2026,
          numericValue: 10,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(missingNarrative).toMatchObject({ status: "error" });
      expect(missingNarrative.message).toContain("requires narrative text");

      const qualitativeSaved = await setCriterionEntryYearData(
        qualitativeEntry.id,
        fixture.tenant.id,
        {
          year: 2026,
          textValue: "The IQAC committee completed an institution-wide quality audit.",
          remarks: "DVV-ready summary",
          reason: "Initial narrative capture",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(qualitativeSaved).toMatchObject({ status: "success" });

      const quantitativeSaved = await setCriterionEntryYearData(
        quantitativeEntry.id,
        fixture.tenant.id,
        {
          year: 2026,
          numericValue: 28,
          remarks: "Pulled from annual research report",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(quantitativeSaved).toMatchObject({ status: "success" });
      if (quantitativeSaved.status !== "success") {
        throw new Error(quantitativeSaved.message);
      }

      const currentYearData = await prisma.criterionYearData.findUniqueOrThrow({
        where: {
          entryId_year: {
            entryId: quantitativeEntry.id,
            year: 2026,
          },
        },
      });

      const staleUpdate = await setCriterionEntryYearData(
        quantitativeEntry.id,
        fixture.tenant.id,
        {
          year: 2026,
          numericValue: 30,
          expectedUpdatedAt: new Date(currentYearData.updatedAt.getTime() - 10_000),
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(staleUpdate).toMatchObject({ status: "error" });
      expect(staleUpdate.message).toContain("modified");

      const changeLog = await listCriterionEntryChangeLog(
        qualitativeEntry.id,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(changeLog).toMatchObject({ status: "success" });
      if (changeLog.status !== "success") {
        throw new Error(changeLog.message);
      }

      const textChange = changeLog.changes.find(
        (change: (typeof changeLog.changes)[number]) => change.fieldChanged === "textValue",
      );
      expect(textChange).toBeDefined();
      expect(textChange).toMatchObject({
        oldValue: null,
        newValue: null,
        changeMeta: {
          changed: true,
          lengthBefore: 0,
        },
      });
    });
  });

  test("weighted recent aggregation renormalizes correctly when fewer years are present", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        periodStart: new Date("2024-01-01T00:00:00.000Z"),
        periodEnd: new Date("2026-12-31T00:00:00.000Z"),
        criteria: [
          {
            criterionCode: "CR1",
            title: "Weighted Research Trend",
            maxScore: 100,
            yearAggregation: CriterionYearAggregation.WEIGHTED_RECENT,
          },
        ],
      });

      const entry = fixture.entriesByCode.get("CR1");
      expect(entry).toBeDefined();
      if (!entry) {
        throw new Error("Entry was not created.");
      }

      for (const [year, numericValue] of [
        [2024, 10],
        [2025, 20],
        [2026, 30],
      ] as const) {
        const saved = await setCriterionEntryYearData(
          entry.id,
          fixture.tenant.id,
          { year, numericValue },
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(saved).toMatchObject({ status: "success" });
      }

      const scoring = await computeAssessmentWorkspaceScores(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(scoring).toMatchObject({ status: "success" });
      if (scoring.status !== "success") {
        throw new Error(scoring.message);
      }

      const refreshedEntry = await prisma.criterionEntry.findUniqueOrThrow({
        where: { id: entry.id },
        select: {
          computedScore: true,
          finalScore: true,
        },
      });

      expect(refreshedEntry.computedScore).toBeCloseTo(22.22, 2);
      expect(refreshedEntry.finalScore).toBeCloseTo(22.22, 2);
    });
  });

  test("workspace readiness, evidence safeguards, freeze snapshots, drift, and notifications work end to end", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        criteria: [
          {
            criterionCode: "CR1",
            title: "Annual Research Report",
            maxScore: 100,
            expectedEvidence: [{ docType: "REPORT", required: true }],
          },
        ],
      });

      const viewer = await createTestUser(tracker, {
        firstName: "Viewer",
        lastName: "Member",
      });
      await createTestMembership({
        tenantId: fixture.tenant.id,
        userId: viewer.id,
        role: "TENANT_USER",
        createdByUserId: fixture.actor.id,
      });

      const collaborator = await addAssessmentWorkspaceCollaborator(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          userId: viewer.id,
          role: WorkspaceCollaboratorRole.VIEWER,
          assignedSections: [],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(collaborator).toMatchObject({ status: "success" });

      const milestone = await addAssessmentWorkspaceMilestone(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          title: "DVV Signoff",
          dueDate: new Date("2026-10-15T00:00:00.000Z"),
          gatesFreeze: true,
          sortOrder: 1,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(milestone).toMatchObject({ status: "success" });
      if (milestone.status !== "success") {
        throw new Error(milestone.message);
      }

      const entry = fixture.entriesByCode.get("CR1");
      expect(entry).toBeDefined();
      if (!entry) {
        throw new Error("Entry was not created.");
      }

      const yearSaved = await setCriterionEntryYearData(
        entry.id,
        fixture.tenant.id,
        {
          year: 2026,
          numericValue: 60,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(yearSaved).toMatchObject({ status: "success" });

      const invalidJump = await updateCriterionEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: CriterionEntryStatus.APPROVED,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(invalidJump).toMatchObject({ status: "error" });
      expect(invalidJump.message).toContain("cannot transition");

      for (const status of [
        CriterionEntryStatus.COMPLETE,
        CriterionEntryStatus.UNDER_REVIEW,
        CriterionEntryStatus.APPROVED,
      ]) {
        const updated = await updateCriterionEntryStatus(
          entry.id,
          fixture.tenant.id,
          { status },
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(updated).toMatchObject({ status: "success" });
      }

      const readinessBeforeCompute = await checkAssessmentWorkspaceReadiness(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(readinessBeforeCompute).toMatchObject({ status: "success" });
      if (readinessBeforeCompute.status !== "success") {
        throw new Error(readinessBeforeCompute.message);
      }
      expect(readinessBeforeCompute.readiness.canFreeze).toBe(false);
      expect(
        readinessBeforeCompute.readiness.blockers.map((blocker) => blocker.code),
      ).toEqual(
        expect.arrayContaining(["SCORES_STALE", "MISSING_REQUIRED_EVIDENCE", "MILESTONE_BLOCKING"]),
      );

      const computed = await computeAssessmentWorkspaceScores(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(computed).toMatchObject({ status: "success" });

      const evidence = await createAssessmentWorkspaceEvidence(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          title: "Board Approved Research Report",
          docType: "REPORT",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(evidence).toMatchObject({ status: "success" });
      if (evidence.status !== "success") {
        throw new Error(evidence.message);
      }

      const firstVersion = await addAssessmentWorkspaceEvidenceVersion(
        evidence.evidence.id,
        fixture.tenant.id,
        {
          fileName: "research-report-v1.pdf",
          fileUrl: "https://example.com/research-report-v1.pdf",
          isFinal: false,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(firstVersion).toMatchObject({ status: "success" });

      const link = await linkAssessmentWorkspaceEvidence(
        evidence.evidence.id,
        fixture.tenant.id,
        {
          entryId: entry.id,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(link).toMatchObject({ status: "success" });

      const deleteBlocked = await deleteAssessmentWorkspaceEvidence(
        evidence.evidence.id,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(deleteBlocked).toMatchObject({ status: "error" });
      expect(deleteBlocked.message).toContain("CR1");

      const readinessWithWarning = await checkAssessmentWorkspaceReadiness(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(readinessWithWarning).toMatchObject({ status: "success" });
      if (readinessWithWarning.status !== "success") {
        throw new Error(readinessWithWarning.message);
      }
      expect(readinessWithWarning.readiness.blockers.map((blocker) => blocker.code)).toEqual([
        "MILESTONE_BLOCKING",
      ]);
      expect(readinessWithWarning.readiness.warnings.map((warning) => warning.code)).toContain(
        "EVIDENCE_NOT_FINAL",
      );

      const milestoneCompleted = await updateAssessmentWorkspaceMilestone(
        milestone.milestone.id,
        fixture.tenant.id,
        {
          isCompleted: true,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(milestoneCompleted).toMatchObject({ status: "success" });

      const finalVersion = await addAssessmentWorkspaceEvidenceVersion(
        evidence.evidence.id,
        fixture.tenant.id,
        {
          fileName: "research-report-v2.pdf",
          fileUrl: "https://example.com/research-report-v2.pdf",
          isFinal: true,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(finalVersion).toMatchObject({ status: "success" });

      const frozen = await freezeAssessmentWorkspace(
        fixture.workspaceId,
        fixture.tenant.id,
        {},
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(frozen).toMatchObject({ status: "success" });

      const frozenWorkspace = await prisma.assessmentWorkspace.findUniqueOrThrow({
        where: { id: fixture.workspaceId },
        select: {
          status: true,
          lastFrozenSnapshotId: true,
        },
      });
      expect(frozenWorkspace.status).toBe(AssessmentWorkspaceStatus.FROZEN);
      expect(frozenWorkspace.lastFrozenSnapshotId).toBeTruthy();

      const notificationsAfterFreeze = await prisma.notification.findMany({
        where: {
          tenantId: fixture.tenant.id,
          userId: viewer.id,
        },
      });
      expect(notificationsAfterFreeze.length).toBeGreaterThan(0);

      const unfrozen = await unfreezeAssessmentWorkspace(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          reason: "Need to correct section data.",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(unfrozen).toMatchObject({ status: "success" });

      const reopenedAttempt = await updateCriterionEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: CriterionEntryStatus.IN_PROGRESS,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(reopenedAttempt).toMatchObject({ status: "success" });

      const latestYearData = await prisma.criterionYearData.findUniqueOrThrow({
        where: {
          entryId_year: {
            entryId: entry.id,
            year: 2026,
          },
        },
      });
      const updatedYearData = await setCriterionEntryYearData(
        entry.id,
        fixture.tenant.id,
        {
          year: 2026,
          numericValue: 80,
          expectedUpdatedAt: latestYearData.updatedAt,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(updatedYearData).toMatchObject({ status: "success" });

      const recomputed = await computeAssessmentWorkspaceScores(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(recomputed).toMatchObject({ status: "success" });

      const manualSnapshot = await takeAssessmentWorkspaceSnapshot(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          snapshotName: "Post-unfreeze snapshot",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(manualSnapshot).toMatchObject({ status: "success" });
      if (manualSnapshot.status !== "success") {
        throw new Error(manualSnapshot.message);
      }

      const snapshots = await listAssessmentWorkspaceSnapshots(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(snapshots).toMatchObject({ status: "success" });
      if (snapshots.status !== "success" || !frozenWorkspace.lastFrozenSnapshotId) {
        throw new Error("Expected workspace snapshots were not available.");
      }
      expect(snapshots.snapshots).toHaveLength(2);

      const comparison = await compareAssessmentWorkspaceSnapshots(
        frozenWorkspace.lastFrozenSnapshotId,
        manualSnapshot.snapshot.id,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(comparison).toMatchObject({ status: "success" });
      if (comparison.status !== "success") {
        throw new Error(comparison.message);
      }
      expect(comparison.comparison.deltas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            criterionCode: "CR1",
          }),
        ]),
      );

      const drift = await checkAssessmentWorkspaceDrift(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(drift).toMatchObject({ status: "success" });
      if (drift.status !== "success") {
        throw new Error(drift.message);
      }
      expect(drift.drift.hasDrift).toBe(true);
      expect(drift.drift.deltas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            criterionCode: "CR1",
          }),
        ]),
      );
    });
  });

  test("manual override limits, import, clone, and viewer permissions behave correctly", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        criteria: [
          {
            criterionCode: "CR1",
            title: "Research Output",
            maxScore: 40,
          },
          {
            criterionCode: "CR2",
            title: "Quality Narrative",
            dataType: CriterionDataType.QUALITATIVE,
            maxScore: 60,
          },
        ],
      });

      const entry = fixture.entriesByCode.get("CR1");
      expect(entry).toBeDefined();
      if (!entry) {
        throw new Error("Entry was not created.");
      }

      const overrideRejected = await setCriterionEntryManualOverride(
        entry.id,
        fixture.tenant.id,
        {
          manualOverride: 99,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(overrideRejected).toMatchObject({ status: "error" });
      expect(overrideRejected.message).toContain("effective maximum score");

      const forceWithoutReason = await setCriterionEntryManualOverride(
        entry.id,
        fixture.tenant.id,
        {
          manualOverride: 99,
          force: true,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(forceWithoutReason).toMatchObject({ status: "error" });
      expect(forceWithoutReason.message).toContain("require a reason");

      const forcedOverride = await setCriterionEntryManualOverride(
        entry.id,
        fixture.tenant.id,
        {
          manualOverride: 99,
          force: true,
          reason: "Exceptional senate-approved bonus weighting",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(forcedOverride).toMatchObject({ status: "success" });

      const imported = await importAssessmentWorkspaceData(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          fileName: "workspace-import.csv",
          buffer: Buffer.from(
            [
              "criterionCode,year,numericValue,textValue,remarks",
              "CR1,2026,18,,Imported numeric row",
              "CR2,2026,,Narrative evidence collected,Imported text row",
              "MISSING,2026,10,,Unknown criterion",
            ].join("\n"),
            "utf8",
          ),
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(imported).toMatchObject({ status: "success" });
      if (imported.status !== "success") {
        throw new Error(imported.message);
      }
      expect(imported.imported).toBe(2);
      expect(imported.skipped).toBe(1);
      expect(imported.errors[0]).toContain("criterion MISSING");

      const viewer = await createTestUser(tracker, {
        firstName: "Read",
        lastName: "Only",
      });
      await createTestMembership({
        tenantId: fixture.tenant.id,
        userId: viewer.id,
        role: "TENANT_USER",
        createdByUserId: fixture.actor.id,
      });

      const viewerAdded = await addAssessmentWorkspaceCollaborator(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          userId: viewer.id,
          role: WorkspaceCollaboratorRole.VIEWER,
          assignedSections: [],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(viewerAdded).toMatchObject({ status: "success" });

      const viewerWorkspace = await getAssessmentWorkspace(
        fixture.workspaceId,
        fixture.tenant.id,
        viewer.id,
        "TENANT_USER",
      );
      expect(viewerWorkspace).toMatchObject({ status: "success" });

      const viewerEntries = await listAssessmentWorkspaceEntries(
        fixture.workspaceId,
        fixture.tenant.id,
        viewer.id,
        "TENANT_USER",
      );
      expect(viewerEntries).toMatchObject({ status: "success" });

      const viewerEditBlocked = await setCriterionEntryYearData(
        entry.id,
        fixture.tenant.id,
        {
          year: 2026,
          numericValue: 25,
        },
        viewer.id,
        "TENANT_USER",
      );
      expect(viewerEditBlocked).toMatchObject({ status: "error" });
      expect(viewerEditBlocked.message).toContain("do not have permission");

      const cloned = await cloneAssessmentWorkspace(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          title: "Assessment Workspace Clone",
          periodStart: new Date("2026-01-01T00:00:00.000Z"),
          periodEnd: new Date("2026-12-31T00:00:00.000Z"),
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(cloned).toMatchObject({ status: "success" });
      if (cloned.status !== "success") {
        throw new Error(cloned.message);
      }

      const cloneWorkspaceId = (cloned.workspace as { id: string }).id;
      const clonedRows = await prisma.criterionYearData.findMany({
        where: {
          entry: {
            workspaceId: cloneWorkspaceId,
          },
        },
        select: {
          year: true,
          actualValue: true,
          textValue: true,
          dataSource: true,
          sourceRef: true,
        },
        orderBy: [{ year: "asc" }],
      });

      expect(clonedRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            year: 2026,
            actualValue: 18,
            dataSource: "CLONED",
            sourceRef: fixture.workspaceId,
          }),
          expect.objectContaining({
            year: 2026,
            textValue: "Narrative evidence collected",
            dataSource: "CLONED",
            sourceRef: fixture.workspaceId,
          }),
        ]),
      );
    });
  });

  test("section collaboration enforces compatible assignments, reviewer consensus, and invalidation", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        title: "Collaboration Workspace",
        criteria: [
          {
            criterionCode: "3",
            title: "Research and Innovation",
            maxScore: 100,
          },
        ],
      });

      const sectionCriterionId = fixture.criteriaByCode.get("3")?.id;
      const entry = fixture.entriesByCode.get("3");
      expect(sectionCriterionId).toBeDefined();
      expect(entry).toBeDefined();
      if (!sectionCriterionId || !entry) {
        throw new Error("Section fixture was not created.");
      }

      const responsible = await createWorkspaceCollaborator({
        tracker,
        tenantId: fixture.tenant.id,
        workspaceId: fixture.workspaceId,
        actorUserId: fixture.actor.id,
        firstName: "Riya",
        lastName: "Lead",
        role: WorkspaceCollaboratorRole.RESPONSIBLE,
      });
      const reviewerOne = await createWorkspaceCollaborator({
        tracker,
        tenantId: fixture.tenant.id,
        workspaceId: fixture.workspaceId,
        actorUserId: fixture.actor.id,
        firstName: "Rohan",
        lastName: "Reviewer",
        role: WorkspaceCollaboratorRole.REVIEWER,
      });
      const reviewerTwo = await createWorkspaceCollaborator({
        tracker,
        tenantId: fixture.tenant.id,
        workspaceId: fixture.workspaceId,
        actorUserId: fixture.actor.id,
        firstName: "Meera",
        lastName: "Reviewer",
        role: WorkspaceCollaboratorRole.REVIEWER,
      });
      const approver = await createWorkspaceCollaborator({
        tracker,
        tenantId: fixture.tenant.id,
        workspaceId: fixture.workspaceId,
        actorUserId: fixture.actor.id,
        firstName: "Aman",
        lastName: "Approver",
        role: WorkspaceCollaboratorRole.APPROVER,
      });
      const viewer = await createWorkspaceCollaborator({
        tracker,
        tenantId: fixture.tenant.id,
        workspaceId: fixture.workspaceId,
        actorUserId: fixture.actor.id,
        firstName: "Vani",
        lastName: "Viewer",
        role: WorkspaceCollaboratorRole.VIEWER,
      });

      const incompatibleAssignment = await bulkAssignAssessmentWorkspaceSections(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          assignments: [
            {
              sectionCriterionId,
              userId: viewer.user.id,
              role: "REVIEWER",
            },
          ],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(incompatibleAssignment).toMatchObject({ status: "error" });
      expect(incompatibleAssignment.message).toContain("not compatible");

      const assignments = [
        {
          sectionCriterionId,
          userId: responsible.user.id,
          role: "SECTION_LEAD" as const,
          deadline: new Date("2025-12-31T00:00:00.000Z"),
        },
        {
          sectionCriterionId,
          userId: reviewerOne.user.id,
          role: "REVIEWER" as const,
        },
        {
          sectionCriterionId,
          userId: reviewerTwo.user.id,
          role: "REVIEWER" as const,
        },
        {
          sectionCriterionId,
          userId: approver.user.id,
          role: "APPROVER" as const,
        },
      ];

      const assigned = await bulkAssignAssessmentWorkspaceSections(
        fixture.workspaceId,
        fixture.tenant.id,
        { assignments },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(assigned).toMatchObject({ status: "success", assignmentCount: 4 });

      const assignedAgain = await bulkAssignAssessmentWorkspaceSections(
        fixture.workspaceId,
        fixture.tenant.id,
        { assignments },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(assignedAgain).toMatchObject({ status: "success", assignmentCount: 4 });

      const assignmentCount = await prisma.workspaceSectionAssignment.count({
        where: {
          workspaceId: fixture.workspaceId,
          sectionCriterionId,
        },
      });
      expect(assignmentCount).toBe(4);

      const sectionsForResponsible = await listAssessmentWorkspaceSections(
        fixture.workspaceId,
        fixture.tenant.id,
        responsible.user.id,
        "TENANT_USER",
      );
      expect(sectionsForResponsible).toMatchObject({ status: "success" });
      if (sectionsForResponsible.status !== "success") {
        throw new Error(sectionsForResponsible.message);
      }
      expect(sectionsForResponsible.sections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sectionCriterionId,
            overdueAssignments: 1,
            currentUserRoles: expect.arrayContaining(["SECTION_LEAD"]),
          }),
        ]),
      );

      const submitTooEarly = await submitAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionCriterionId },
        responsible.user.id,
        "TENANT_USER",
      );
      expect(submitTooEarly).toMatchObject({ status: "error" });
      expect(submitTooEarly.message).toContain("must be approved");

      const yearDataEntered = await setCriterionEntryYearData(
        entry.id,
        fixture.tenant.id,
        {
          year: 2026,
          numericValue: 82,
        },
        responsible.user.id,
        "TENANT_USER",
      );
      expect(yearDataEntered).toMatchObject({ status: "success" });

      const completedEntry = await updateCriterionEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: CriterionEntryStatus.COMPLETE,
        },
        responsible.user.id,
        "TENANT_USER",
      );
      expect(completedEntry).toMatchObject({ status: "success" });

      const underReviewEntry = await updateCriterionEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: CriterionEntryStatus.UNDER_REVIEW,
        },
        reviewerOne.user.id,
        "TENANT_USER",
      );
      expect(underReviewEntry).toMatchObject({ status: "success" });

      const approvedEntry = await updateCriterionEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: CriterionEntryStatus.APPROVED,
        },
        approver.user.id,
        "TENANT_USER",
      );
      expect(approvedEntry).toMatchObject({ status: "success" });

      const submitted = await submitAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionCriterionId },
        responsible.user.id,
        "TENANT_USER",
      );
      expect(submitted).toMatchObject({ status: "success", nextStatus: "OWNER_SUBMITTED" });

      const changesWithoutComment = await requestChangesAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionCriterionId },
        reviewerOne.user.id,
        "TENANT_USER",
      );
      expect(changesWithoutComment).toMatchObject({ status: "error" });
      expect(changesWithoutComment.message).toContain("comment is required");

      const reviewerOneConfirmed = await confirmAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionCriterionId },
        reviewerOne.user.id,
        "TENANT_USER",
      );
      expect(reviewerOneConfirmed).toMatchObject({ status: "success", nextStatus: "OWNER_SUBMITTED" });

      const approveTooEarly = await approveAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionCriterionId },
        approver.user.id,
        "TENANT_USER",
      );
      expect(approveTooEarly).toMatchObject({ status: "error" });
      expect(approveTooEarly.message).toContain("All assigned reviewers must confirm");

      const reviewerTwoConfirmed = await confirmAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionCriterionId },
        reviewerTwo.user.id,
        "TENANT_USER",
      );
      expect(reviewerTwoConfirmed).toMatchObject({ status: "success", nextStatus: "REVIEW_CONFIRMED" });

      const sectionApproved = await approveAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionCriterionId },
        approver.user.id,
        "TENANT_USER",
      );
      expect(sectionApproved).toMatchObject({ status: "success", nextStatus: "APPROVED" });

      const threadCreated = await createAssessmentWorkspaceDiscussionThread(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          scope: "SECTION",
          sectionCriterionId,
          title: "Scopus count review",
          body: "Please recheck the Scopus count before final submission.",
          mentionedUserIds: [reviewerTwo.user.id],
        },
        responsible.user.id,
        "TENANT_USER",
      );
      expect(threadCreated).toMatchObject({ status: "success" });
      if (threadCreated.status !== "success") {
        throw new Error(threadCreated.message);
      }
      expect(threadCreated.thread.messages[0]?.isPostApproval).toBe(true);

      const replyAdded = await addAssessmentWorkspaceDiscussionMessage(
        threadCreated.thread.id,
        fixture.tenant.id,
        {
          body: "I have double-checked the count.",
          mentionedUserIds: [responsible.user.id],
        },
        reviewerTwo.user.id,
        "TENANT_USER",
      );
      expect(replyAdded).toMatchObject({ status: "success" });

      const mentionNotification = await prisma.notification.findFirst({
        where: {
          tenantId: fixture.tenant.id,
          userId: reviewerTwo.user.id,
          type: "accreditation.discussion.message",
        },
      });
      expect(mentionNotification).toBeTruthy();

      const invalidatingEdit = await setCriterionEntryYearData(
        entry.id,
        fixture.tenant.id,
        {
          year: 2026,
          numericValue: 88,
          reason: "Updated after committee review.",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(invalidatingEdit).toMatchObject({ status: "success" });

      const sectionsAfterInvalidation = await listAssessmentWorkspaceSections(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(sectionsAfterInvalidation).toMatchObject({ status: "success" });
      if (sectionsAfterInvalidation.status !== "success") {
        throw new Error(sectionsAfterInvalidation.message);
      }
      expect(sectionsAfterInvalidation.sections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sectionCriterionId,
            status: "IN_PROGRESS",
          }),
        ]),
      );

      const removalBlocked = await removeAssessmentWorkspaceCollaborator(
        fixture.workspaceId,
        reviewerOne.user.id,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(removalBlocked).toMatchObject({ status: "error" });
      expect(removalBlocked.message).toContain("section assignments");

      const replacementReviewer = await createWorkspaceCollaborator({
        tracker,
        tenantId: fixture.tenant.id,
        workspaceId: fixture.workspaceId,
        actorUserId: fixture.actor.id,
        firstName: "Nikita",
        lastName: "Replacement",
        role: WorkspaceCollaboratorRole.REVIEWER,
      });

      const reassigned = await reassignAssessmentWorkspaceSection(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          sectionCriterionId,
          fromUserId: reviewerOne.user.id,
          toUserId: replacementReviewer.user.id,
          role: "REVIEWER",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(reassigned).toMatchObject({ status: "success" });
      if (reassigned.status !== "success") {
        throw new Error(reassigned.message);
      }
      expect(reassigned.handoffSummary).toEqual(
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({
              criterionCode: "3",
            }),
          ]),
          openThreads: expect.arrayContaining([
            expect.objectContaining({
              title: "Scopus count review",
            }),
          ]),
        }),
      );
    });
  });

  test("data gaps, reuse preview/apply, evidence version deletion, activity, and manifest are available", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        title: "Manifest Workspace",
        periodStart: new Date("2025-01-01T00:00:00.000Z"),
        periodEnd: new Date("2026-12-31T00:00:00.000Z"),
        criteria: [
          {
            criterionCode: "5",
            title: "Student Support",
            maxScore: 100,
          },
        ],
      });

      const entry = fixture.entriesByCode.get("5");
      const sectionCriterionId = fixture.criteriaByCode.get("5")?.id;
      expect(entry).toBeDefined();
      expect(sectionCriterionId).toBeDefined();
      if (!entry || !sectionCriterionId) {
        throw new Error("Manifest fixture was not created.");
      }

      const viewer = await createWorkspaceCollaborator({
        tracker,
        tenantId: fixture.tenant.id,
        workspaceId: fixture.workspaceId,
        actorUserId: fixture.actor.id,
        firstName: "Isha",
        lastName: "Viewer",
        role: WorkspaceCollaboratorRole.VIEWER,
      });

      const initialWorkspace = await getAssessmentWorkspace(
        fixture.workspaceId,
        fixture.tenant.id,
        viewer.user.id,
        "TENANT_USER",
      );
      expect(initialWorkspace).toMatchObject({ status: "success" });

      const initialGaps = await getAssessmentWorkspaceDataGaps(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(initialGaps).toMatchObject({ status: "success" });
      if (initialGaps.status !== "success") {
        throw new Error(initialGaps.message);
      }
      expect(initialGaps.gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            criterionCode: "5",
            missingYears: [2025, 2026],
          }),
        ]),
      );

      const sourceWorkspaceResult = await createAssessmentWorkspace(
        fixture.tenant.id,
        {
          versionId: fixture.version.id,
          profileId: fixture.profile.id,
          title: "Archived Source Workspace",
          periodStart: new Date("2025-01-01T00:00:00.000Z"),
          periodEnd: new Date("2026-12-31T00:00:00.000Z"),
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(sourceWorkspaceResult).toMatchObject({ status: "success" });
      if (sourceWorkspaceResult.status !== "success") {
        throw new Error(sourceWorkspaceResult.message);
      }

      const sourceWorkspaceId = (sourceWorkspaceResult.workspace as { id: string }).id;
      const sourceEntry = await prisma.criterionEntry.findFirstOrThrow({
        where: {
          workspaceId: sourceWorkspaceId,
          criterion: {
            criterionCode: "5",
          },
        },
      });

      const sourceYearData = await setCriterionEntryYearData(
        sourceEntry.id,
        fixture.tenant.id,
        {
          year: 2025,
          numericValue: 64,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(sourceYearData).toMatchObject({ status: "success" });

      const archivedSource = await updateAssessmentWorkspaceStatus(
        sourceWorkspaceId,
        fixture.tenant.id,
        {
          status: AssessmentWorkspaceStatus.ARCHIVED,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(archivedSource).toMatchObject({ status: "success" });

      const preview = await previewAssessmentWorkspaceReuse(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          sourceWorkspaceId,
          sectionCriterionIds: [sectionCriterionId],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(preview).toMatchObject({ status: "success" });
      if (preview.status !== "success") {
        throw new Error(preview.message);
      }
      expect(preview.preview.willCopy).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            criterionCode: "5",
            years: [2025],
          }),
        ]),
      );

      const appliedReuse = await applyAssessmentWorkspaceReuse(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          sourceWorkspaceId,
          sectionCriterionIds: [sectionCriterionId],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(appliedReuse).toMatchObject({ status: "success", copiedRows: 1 });

      const reusedRows = await prisma.criterionYearData.findMany({
        where: {
          entryId: entry.id,
        },
        orderBy: { year: "asc" },
      });
      expect(reusedRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            year: 2025,
            actualValue: 64,
            dataSource: "CLONED",
            sourceRef: sourceWorkspaceId,
          }),
        ]),
      );

      const evidence = await createAssessmentWorkspaceEvidence(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          title: "Student support report",
          docType: "REPORT",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(evidence).toMatchObject({ status: "success" });
      if (evidence.status !== "success") {
        throw new Error(evidence.message);
      }

      const versionOne = await addAssessmentWorkspaceEvidenceVersion(
        evidence.evidence.id,
        fixture.tenant.id,
        {
          fileName: "support-v1.pdf",
          fileUrl: "https://example.com/support-v1.pdf",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      const versionTwo = await addAssessmentWorkspaceEvidenceVersion(
        evidence.evidence.id,
        fixture.tenant.id,
        {
          fileName: "support-v2.pdf",
          fileUrl: "https://example.com/support-v2.pdf",
          isFinal: true,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(versionOne).toMatchObject({ status: "success" });
      expect(versionTwo).toMatchObject({ status: "success" });
      if (versionOne.status !== "success" || versionTwo.status !== "success") {
        throw new Error("Evidence versions were not created.");
      }

      const linkedEvidence = await linkAssessmentWorkspaceEvidence(
        evidence.evidence.id,
        fixture.tenant.id,
        {
          entryId: entry.id,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(linkedEvidence).toMatchObject({ status: "success" });

      const finalDeletionBlocked = await deleteAssessmentWorkspaceEvidenceVersion(
        versionTwo.version.id,
        fixture.tenant.id,
        {
          reason: "Testing final-version protection",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(finalDeletionBlocked).toMatchObject({ status: "error" });
      expect(finalDeletionBlocked.message).toContain("cannot be deleted");

      const deletedVersion = await deleteAssessmentWorkspaceEvidenceVersion(
        versionOne.version.id,
        fixture.tenant.id,
        {
          reason: "Uploaded the wrong draft.",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(deletedVersion).toMatchObject({ status: "success" });

      const yearDataEntered = await setCriterionEntryYearData(
        entry.id,
        fixture.tenant.id,
        {
          year: 2026,
          numericValue: 74,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(yearDataEntered).toMatchObject({ status: "success" });

      const entryCompleted = await updateCriterionEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: CriterionEntryStatus.COMPLETE,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(entryCompleted).toMatchObject({ status: "success" });

      const entryUnderReview = await updateCriterionEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: CriterionEntryStatus.UNDER_REVIEW,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(entryUnderReview).toMatchObject({ status: "success" });

      const entryApproved = await updateCriterionEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: CriterionEntryStatus.APPROVED,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(entryApproved).toMatchObject({ status: "success" });

      const computed = await computeAssessmentWorkspaceScores(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(computed).toMatchObject({ status: "success" });

      const activityBeforeChanges = await getAssessmentWorkspaceActivitySinceLastVisit(
        fixture.workspaceId,
        fixture.tenant.id,
        viewer.user.id,
        "TENANT_USER",
      );
      expect(activityBeforeChanges).toMatchObject({ status: "success" });

      const postVisitEdit = await setCriterionEntryYearData(
        entry.id,
        fixture.tenant.id,
        {
          year: 2025,
          numericValue: 68,
          reason: "Updated after viewer baseline for activity tracking.",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(postVisitEdit).toMatchObject({ status: "success" });

      const workspaceThread = await createAssessmentWorkspaceDiscussionThread(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          scope: "WORKSPACE",
          title: "Submission timing",
          body: "Let us freeze this tomorrow morning.",
          mentionedUserIds: [viewer.user.id],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(workspaceThread).toMatchObject({ status: "success" });

      const activityAfterChanges = await getAssessmentWorkspaceActivitySinceLastVisit(
        fixture.workspaceId,
        fixture.tenant.id,
        viewer.user.id,
        "TENANT_USER",
      );
      expect(activityAfterChanges).toMatchObject({ status: "success" });
      if (activityAfterChanges.status !== "success") {
        throw new Error(activityAfterChanges.message);
      }
      expect(activityAfterChanges.activity.entryChanges).toBeGreaterThanOrEqual(1);
      expect(activityAfterChanges.activity.unreadThreads).toBeGreaterThanOrEqual(1);

      const frozen = await freezeAssessmentWorkspace(
        fixture.workspaceId,
        fixture.tenant.id,
        {},
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(frozen).toMatchObject({ status: "success" });

      const submitted = await updateAssessmentWorkspaceStatus(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          status: AssessmentWorkspaceStatus.SUBMITTED,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(submitted).toMatchObject({ status: "success" });

      const manifest = await getAssessmentWorkspaceSubmissionManifest(
        fixture.workspaceId,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(manifest).toMatchObject({ status: "success" });
      if (manifest.status !== "success") {
        throw new Error(manifest.message);
      }
      expect(manifest.manifest.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            criterionCode: "5",
            evidence: expect.arrayContaining([
              expect.objectContaining({
                finalVersions: expect.arrayContaining([
                  expect.objectContaining({
                    fileName: "support-v2.pdf",
                    isFinal: true,
                  }),
                ]),
              }),
            ]),
          }),
        ]),
      );
      expect(manifest.manifest.lastFreezeLog).toBeTruthy();
    });
  });
});
