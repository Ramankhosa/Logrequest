import {
  AssessmentWorkspaceStatus,
  CriterionDataType,
  BlockEntryStatus,
  CriterionYearAggregation,
  ProjectionStorageMode,
  TenantServiceCode,
  WorkspaceCollaboratorRole,
} from "@prisma/client";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createTenantAccreditationBody,
  createTenantBodyVersion,
  createTenantVersionBlock,
  createTenantVersionProfile,
} from "@/lib/accreditation/service";
import {
  addAssessmentWorkspaceCollaborator,
  addAssessmentWorkspaceEvidenceVersion,
  addAssessmentWorkspaceMilestone,
  addAssessmentWorkspaceDiscussionMessage,
  approveAssessmentWorkspaceSectionReview,
  applyAssessmentWorkspaceReuse,
  applyBlockEntryProjection,
  bulkAssignAssessmentWorkspaceSections,
  checkAssessmentWorkspaceDrift,
  checkAssessmentWorkspaceReadiness,
  cloneAssessmentWorkspace,
  compareAssessmentWorkspaceSnapshots,
  confirmAssessmentWorkspaceSectionReview,
  computeAssessmentWorkspaceScores,
  createTenantSourceMetric,
  createAssessmentWorkspace,
  createAssessmentWorkspaceDiscussionThread,
  createAssessmentWorkspaceEvidence,
  deleteAssessmentWorkspaceEvidence,
  deleteAssessmentWorkspaceEvidenceVersion,
  detachBlockEntryProjection,
  freezeAssessmentWorkspace,
  getAssessmentWorkspaceActivitySinceLastVisit,
  getAssessmentWorkspaceDataGaps,
  getAssessmentWorkspaceSubmissionManifest,
  getAssessmentWorkspace,
  importAssessmentWorkspaceData,
  initializeAssessmentWorkspaceEntries,
  listBlockEntryChangeLog,
  listAssessmentWorkspaceEntries,
  listAssessmentWorkspaceSections,
  listAssessmentWorkspaceSnapshots,
  listBlockEntryProjectionSources,
  previewAssessmentWorkspaceReuse,
  previewBlockEntryProjection,
  refreshBlockEntryProjection,
  reassignAssessmentWorkspaceSection,
  removeAssessmentWorkspaceCollaborator,
  requestChangesAssessmentWorkspaceSectionReview,
  setBlockEntryManualOverride,
  setBlockEntryResponse,
  submitAssessmentWorkspaceSectionReview,
  takeAssessmentWorkspaceSnapshot,
  unfreezeAssessmentWorkspace,
  upsertTenantSourceMetricObservations,
  updateAssessmentWorkspaceStatus,
  updateAssessmentWorkspaceMilestone,
  updateBlockEntryStatus,
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
  blockCode: string;
  title: string;
  dataType?: CriterionDataType;
  maxScore?: number | null;
  expectedEvidence?: unknown;
  validationRules?: unknown;
  yearAggregation?: CriterionYearAggregation;
  yearAggregationConfig?: unknown;
  inputSchema?: unknown;
  calculationRule?: unknown;
  scoringRule?: unknown;
  dependencyRules?: unknown;
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
    const criterionResult = await createTenantVersionBlock(
      context.tenant.id,
      context.version.id,
      {
        blockCode: criterionSpec.blockCode,
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
      await prisma.criterionBlock.update({
        where: { id: criterionResult.block.id },
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

    if (
      criterionSpec.inputSchema !== undefined ||
      criterionSpec.calculationRule !== undefined ||
      criterionSpec.scoringRule !== undefined ||
      criterionSpec.dependencyRules !== undefined
    ) {
      await prisma.criterionBlock.update({
        where: { id: criterionResult.block.id },
        data: {
          ...(criterionSpec.inputSchema !== undefined
            ? { inputSchema: criterionSpec.inputSchema as never }
            : {}),
          ...(criterionSpec.calculationRule !== undefined
            ? { calculationRule: criterionSpec.calculationRule as never }
            : {}),
          ...(criterionSpec.scoringRule !== undefined
            ? { scoringRule: criterionSpec.scoringRule as never }
            : {}),
          ...(criterionSpec.dependencyRules !== undefined
            ? { dependencyRules: criterionSpec.dependencyRules as never }
            : {}),
        },
      });
    }

    criteriaByCode.set(criterionSpec.blockCode, {
      id: criterionResult.block.id,
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
  const entryRows = await prisma.blockEntry.findMany({
    where: { workspaceId },
    include: {
      block: {
        select: {
          blockCode: true,
        },
      },
      responses: {
        orderBy: { year: "asc" },
      },
    },
  });
  const entriesByCode = new Map(entryRows.map((entry) => [entry.block.blockCode, entry]));

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
            blockCode: "CR1",
            title: "Research Output",
            maxScore: 40,
          },
          {
            blockCode: "CR2",
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
            blockCode: "CR1",
            title: "Research Output",
            maxScore: 40,
          },
          {
            blockCode: "CR2",
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

      const outOfRange = await setBlockEntryResponse(
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

      const missingNarrative = await setBlockEntryResponse(
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

      const qualitativeSaved = await setBlockEntryResponse(
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

      const quantitativeSaved = await setBlockEntryResponse(
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

      const currentYearData = await prisma.blockEntryResponse.findUniqueOrThrow({
        where: {
          entryId_scopeKey: {
            entryId: quantitativeEntry.id,
            scopeKey: "YEAR:2026",
          },
        },
      });

      const staleUpdate = await setBlockEntryResponse(
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

      const changeLog = await listBlockEntryChangeLog(
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
        (change: (typeof changeLog.changes)[number]) => change.fieldChanged === "responseData.narrative",
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
            blockCode: "CR1",
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
        const saved = await setBlockEntryResponse(
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

      const refreshedEntry = await prisma.blockEntry.findUniqueOrThrow({
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

  test("block-native formula scoring computes structured response inputs and persists computed output", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        criteria: [
          {
            blockCode: "CR1",
            title: "Publications Per Faculty",
            maxScore: 10,
            inputSchema: {
              fields: {
                publication_count: { required: true, mergeMode: "REPLACE" },
                faculty_count: { required: true, mergeMode: "REPLACE" },
              },
            },
            calculationRule: {
              inputs: {
                publication_count: { source: "response.publication_count", required: true },
                faculty_count: { source: "response.faculty_count", required: true },
              },
              steps: [
                {
                  type: "FORMULA",
                  outputKey: "pub_per_faculty",
                  formula: "inputs.publication_count / inputs.faculty_count",
                },
              ],
              resultKey: "pub_per_faculty",
            },
            scoringRule: {
              type: "DIRECT",
            },
          },
        ],
      });

      const entry = fixture.entriesByCode.get("CR1");
      expect(entry).toBeDefined();
      if (!entry) {
        throw new Error("Formula fixture entry was not created.");
      }

      const saved = await setBlockEntryResponse(
        entry.id,
        fixture.tenant.id,
        {
          year: 2026,
          responseData: {
            publication_count: 40,
            faculty_count: 10,
          },
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(saved).toMatchObject({ status: "success" });

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

      const refreshedEntry = await prisma.blockEntry.findUniqueOrThrow({
        where: { id: entry.id },
        select: {
          computedScore: true,
          finalScore: true,
          executionStatus: true,
        },
      });
      expect(refreshedEntry.computedScore).toBe(4);
      expect(refreshedEntry.finalScore).toBe(4);
      expect(refreshedEntry.executionStatus).toBe("SUCCESS");

      const refreshedResponse = await prisma.blockEntryResponse.findFirstOrThrow({
        where: { entryId: entry.id, year: 2026 },
        select: {
          computedOutput: true,
        },
      });
      expect(refreshedResponse.computedOutput).toMatchObject({
        publication_count: 40,
        faculty_count: 10,
        pub_per_faculty: 4,
        value: 4,
      });
    });
  });

  test("grade band matching uses half-open ranges so boundary values fall into the upper band", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        criteria: [
          {
            blockCode: "CR1",
            title: "Boundary Metric",
            maxScore: 100,
          },
        ],
      });

      await prisma.accreditationGradeBand.createMany({
        data: [
          {
            versionId: fixture.version.id,
            gradeLabel: "B",
            scoreMin: 0,
            scoreMax: 50,
            outcome: "Boundary lower band",
            sortOrder: 0,
          },
          {
            versionId: fixture.version.id,
            gradeLabel: "A",
            scoreMin: 50,
            scoreMax: 100,
            outcome: "Boundary upper band",
            sortOrder: 1,
          },
        ],
      });

      const entry = fixture.entriesByCode.get("CR1");
      expect(entry).toBeDefined();
      if (!entry) {
        throw new Error("Boundary fixture entry was not created.");
      }

      const saved = await setBlockEntryResponse(
        entry.id,
        fixture.tenant.id,
        { year: 2026, numericValue: 50 },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(saved).toMatchObject({ status: "success" });

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

      const workspace = await prisma.assessmentWorkspace.findUniqueOrThrow({
        where: { id: fixture.workspaceId },
        select: {
          overallRawScore: true,
          resolvedGrade: true,
          resolvedOutcome: true,
        },
      });
      expect(workspace.overallRawScore).toBe(50);
      expect(workspace.resolvedGrade).toBe("A");
      expect(workspace.resolvedOutcome).toBe("Boundary upper band");
    });
  });

  test("workspace readiness, evidence safeguards, freeze snapshots, drift, and notifications work end to end", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        criteria: [
          {
            blockCode: "CR1",
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

      const yearSaved = await setBlockEntryResponse(
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

      const invalidJump = await updateBlockEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: BlockEntryStatus.APPROVED,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(invalidJump).toMatchObject({ status: "error" });
      expect(invalidJump.message).toContain("cannot transition");

      for (const status of [
        BlockEntryStatus.COMPLETE,
        BlockEntryStatus.UNDER_REVIEW,
        BlockEntryStatus.APPROVED,
      ]) {
        const updated = await updateBlockEntryStatus(
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

      const reopenedAttempt = await updateBlockEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: BlockEntryStatus.IN_PROGRESS,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(reopenedAttempt).toMatchObject({ status: "success" });

      const latestYearData = await prisma.blockEntryResponse.findUniqueOrThrow({
        where: {
          entryId_scopeKey: {
            entryId: entry.id,
            scopeKey: "YEAR:2026",
          },
        },
      });
      const updatedYearData = await setBlockEntryResponse(
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
            blockCode: "CR1",
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
            blockCode: "CR1",
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
            blockCode: "CR1",
            title: "Research Output",
            maxScore: 40,
          },
          {
            blockCode: "CR2",
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

      const overrideRejected = await setBlockEntryManualOverride(
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

      const forceWithoutReason = await setBlockEntryManualOverride(
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

      const forcedOverride = await setBlockEntryManualOverride(
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
              "blockCode,year,numericValue,textValue,remarks",
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

      const viewerEditBlocked = await setBlockEntryResponse(
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
      const clonedRows = await prisma.blockEntryResponse.findMany({
        where: {
          entry: {
            workspaceId: cloneWorkspaceId,
          },
        },
        select: {
          scopeKey: true,
          year: true,
          responseData: true,
          dataSource: true,
          sourceRef: true,
        },
        orderBy: [{ year: "asc" }],
      });

      expect(clonedRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            year: 2026,
            responseData: expect.objectContaining({
              value: 18,
            }),
            dataSource: "CLONED",
            sourceRef: fixture.workspaceId,
          }),
          expect.objectContaining({
            year: 2026,
            responseData: expect.objectContaining({
              narrative: "Narrative evidence collected",
            }),
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
            blockCode: "3",
            title: "Research and Innovation",
            maxScore: 100,
          },
        ],
      });

      const sectionBlockId = fixture.criteriaByCode.get("3")?.id;
      const entry = fixture.entriesByCode.get("3");
      expect(sectionBlockId).toBeDefined();
      expect(entry).toBeDefined();
      if (!sectionBlockId || !entry) {
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
              sectionBlockId,
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
          sectionBlockId,
          userId: responsible.user.id,
          role: "SECTION_LEAD" as const,
          deadline: new Date("2025-12-31T00:00:00.000Z"),
        },
        {
          sectionBlockId,
          userId: reviewerOne.user.id,
          role: "REVIEWER" as const,
        },
        {
          sectionBlockId,
          userId: reviewerTwo.user.id,
          role: "REVIEWER" as const,
        },
        {
          sectionBlockId,
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
          sectionBlockId,
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
            sectionBlockId,
            overdueAssignments: 1,
            currentUserRoles: expect.arrayContaining(["SECTION_LEAD"]),
          }),
        ]),
      );

      const submitTooEarly = await submitAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionBlockId },
        responsible.user.id,
        "TENANT_USER",
      );
      expect(submitTooEarly).toMatchObject({ status: "error" });
      expect(submitTooEarly.message).toContain("must be approved");

      const yearDataEntered = await setBlockEntryResponse(
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

      const completedEntry = await updateBlockEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: BlockEntryStatus.COMPLETE,
        },
        responsible.user.id,
        "TENANT_USER",
      );
      expect(completedEntry).toMatchObject({ status: "success" });

      const underReviewEntry = await updateBlockEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: BlockEntryStatus.UNDER_REVIEW,
        },
        reviewerOne.user.id,
        "TENANT_USER",
      );
      expect(underReviewEntry).toMatchObject({ status: "success" });

      const approvedEntry = await updateBlockEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: BlockEntryStatus.APPROVED,
        },
        approver.user.id,
        "TENANT_USER",
      );
      expect(approvedEntry).toMatchObject({ status: "success" });

      const submitted = await submitAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionBlockId },
        responsible.user.id,
        "TENANT_USER",
      );
      expect(submitted).toMatchObject({ status: "success", nextStatus: "OWNER_SUBMITTED" });

      const changesWithoutComment = await requestChangesAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionBlockId },
        reviewerOne.user.id,
        "TENANT_USER",
      );
      expect(changesWithoutComment).toMatchObject({ status: "error" });
      expect(changesWithoutComment.message).toContain("comment is required");

      const reviewerOneConfirmed = await confirmAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionBlockId },
        reviewerOne.user.id,
        "TENANT_USER",
      );
      expect(reviewerOneConfirmed).toMatchObject({ status: "success", nextStatus: "OWNER_SUBMITTED" });

      const approveTooEarly = await approveAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionBlockId },
        approver.user.id,
        "TENANT_USER",
      );
      expect(approveTooEarly).toMatchObject({ status: "error" });
      expect(approveTooEarly.message).toContain("All assigned reviewers must confirm");

      const reviewerTwoConfirmed = await confirmAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionBlockId },
        reviewerTwo.user.id,
        "TENANT_USER",
      );
      expect(reviewerTwoConfirmed).toMatchObject({ status: "success", nextStatus: "REVIEW_CONFIRMED" });

      const sectionApproved = await approveAssessmentWorkspaceSectionReview(
        fixture.workspaceId,
        fixture.tenant.id,
        { sectionBlockId },
        approver.user.id,
        "TENANT_USER",
      );
      expect(sectionApproved).toMatchObject({ status: "success", nextStatus: "APPROVED" });

      const threadCreated = await createAssessmentWorkspaceDiscussionThread(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          scope: "SECTION",
          sectionBlockId,
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

      const invalidatingEdit = await setBlockEntryResponse(
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
            sectionBlockId,
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
          sectionBlockId,
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
              blockCode: "3",
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
            blockCode: "5",
            title: "Student Support",
            maxScore: 100,
          },
        ],
      });

      const entry = fixture.entriesByCode.get("5");
      const sectionBlockId = fixture.criteriaByCode.get("5")?.id;
      expect(entry).toBeDefined();
      expect(sectionBlockId).toBeDefined();
      if (!entry || !sectionBlockId) {
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
            blockCode: "5",
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
      const sourceEntry = await prisma.blockEntry.findFirstOrThrow({
        where: {
          workspaceId: sourceWorkspaceId,
          block: {
            blockCode: "5",
          },
        },
      });

      const sourceYearData = await setBlockEntryResponse(
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
          sectionBlockIds: [sectionBlockId],
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
            blockCode: "5",
            years: [2025],
          }),
        ]),
      );

      const appliedReuse = await applyAssessmentWorkspaceReuse(
        fixture.workspaceId,
        fixture.tenant.id,
        {
          sourceWorkspaceId,
          sectionBlockIds: [sectionBlockId],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(appliedReuse).toMatchObject({ status: "success", copiedRows: 1 });

      const reusedRows = await prisma.blockEntryResponse.findMany({
        where: {
          entryId: entry.id,
        },
        orderBy: { year: "asc" },
      });
      expect(reusedRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            year: 2025,
            responseData: expect.objectContaining({
              value: 64,
            }),
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

      const yearDataEntered = await setBlockEntryResponse(
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

      const entryCompleted = await updateBlockEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: BlockEntryStatus.COMPLETE,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(entryCompleted).toMatchObject({ status: "success" });

      const entryUnderReview = await updateBlockEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: BlockEntryStatus.UNDER_REVIEW,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(entryUnderReview).toMatchObject({ status: "success" });

      const entryApproved = await updateBlockEntryStatus(
        entry.id,
        fixture.tenant.id,
        {
          status: BlockEntryStatus.APPROVED,
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

      const postVisitEdit = await setBlockEntryResponse(
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
            blockCode: "5",
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

describe("accreditation workspace projections", () => {
  test("imports source metric slices, refreshes them, and detaches live links", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        criteria: [
          {
            blockCode: "3.2.2",
            title: "Publications per Teacher",
            maxScore: 20,
          },
        ],
        periodStart: new Date("2024-01-01T00:00:00.000Z"),
        periodEnd: new Date("2025-12-31T00:00:00.000Z"),
      });

      const entry = fixture.entriesByCode.get("3.2.2");
      expect(entry).toBeDefined();
      if (!entry) {
        throw new Error("Projection fixture entry was not created.");
      }

      const sourceMetric = await createTenantSourceMetric(
        fixture.tenant.id,
        {
          code: "FACULTY_COUNT",
          name: "Faculty Count",
          valueType: "NUMBER",
          allowedDimensions: {
            department: "Department",
          },
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(sourceMetric).toMatchObject({ status: "success" });
      if (sourceMetric.status !== "success") {
        throw new Error(sourceMetric.message);
      }

      const savedObservations = await upsertTenantSourceMetricObservations(
        sourceMetric.sourceMetric.id,
        fixture.tenant.id,
        {
          observations: [
            {
              observedYear: 2024,
              dimensions: { department: "CSE" },
              numberValue: 93,
            },
            {
              observedYear: 2025,
              dimensions: { department: "CSE" },
              numberValue: 99,
            },
          ],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(savedObservations).toMatchObject({ status: "success" });

      const reusableSources = await listBlockEntryProjectionSources(
        entry.id,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(reusableSources).toMatchObject({ status: "success" });
      if (reusableSources.status !== "success") {
        throw new Error(reusableSources.message);
      }
      expect(reusableSources.sources.sourceMetrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: sourceMetric.sourceMetric.id,
            code: "FACULTY_COUNT",
          }),
        ]),
      );

      const preview = await previewBlockEntryProjection(
        entry.id,
        fixture.tenant.id,
        {
          sourceMetricId: sourceMetric.sourceMetric.id,
          filters: {
            years: [2024],
            dimensions: {
              department: "CSE",
            },
          },
          targetPath: "actualValue",
          storageMode: ProjectionStorageMode.LIVE_REFERENCE,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(preview).toMatchObject({ status: "success" });
      if (preview.status !== "success") {
        throw new Error(preview.message);
      }
      expect(preview.preview.matches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetYear: 2024,
            materializedNumberValue: 93,
          }),
        ]),
      );

      const applied = await applyBlockEntryProjection(
        entry.id,
        fixture.tenant.id,
        {
          sourceMetricId: sourceMetric.sourceMetric.id,
          filters: {
            years: [2024],
            dimensions: {
              department: "CSE",
            },
          },
          targetPath: "actualValue",
          storageMode: ProjectionStorageMode.LIVE_REFERENCE,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(applied).toMatchObject({ status: "success", appliedCount: 1 });
      if (applied.status !== "success") {
        throw new Error(applied.message);
      }

      const projectedYearData = await prisma.blockEntryResponse.findUnique({
        where: {
          entryId_scopeKey: {
            entryId: entry.id,
            scopeKey: "YEAR:2024",
          },
        },
      });
      expect(projectedYearData).toMatchObject({
        responseData: expect.objectContaining({
          value: 93,
        }),
        dataSource: "PROJECTED",
        sourceRef: applied.recipe.id,
      });

      const liveEditBlocked = await setBlockEntryResponse(
        entry.id,
        fixture.tenant.id,
        {
          year: 2024,
          numericValue: 111,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(liveEditBlocked).toMatchObject({
        status: "error",
        message: expect.stringContaining("live projection"),
      });

      const updatedObservations = await upsertTenantSourceMetricObservations(
        sourceMetric.sourceMetric.id,
        fixture.tenant.id,
        {
          observations: [
            {
              observedYear: 2024,
              dimensions: { department: "CSE" },
              numberValue: 101,
            },
          ],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(updatedObservations).toMatchObject({ status: "success" });

      const refreshed = await refreshBlockEntryProjection(
        applied.recipe.id,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(refreshed).toMatchObject({ status: "success", appliedCount: 1 });

      const refreshedYearData = await prisma.blockEntryResponse.findUnique({
        where: {
          entryId_scopeKey: {
            entryId: entry.id,
            scopeKey: "YEAR:2024",
          },
        },
      });
      expect(refreshedYearData).toMatchObject({
        responseData: expect.objectContaining({
          value: 101,
        }),
        dataSource: "PROJECTED",
        sourceRef: applied.recipe.id,
      });

      const detached = await detachBlockEntryProjection(
        applied.recipe.id,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(detached).toMatchObject({ status: "success", detachedCount: 1 });

      const detachedYearData = await prisma.blockEntryResponse.findUnique({
        where: {
          entryId_scopeKey: {
            entryId: entry.id,
            scopeKey: "YEAR:2024",
          },
        },
      });
      expect(detachedYearData).toMatchObject({
        responseData: expect.objectContaining({
          value: 101,
        }),
        dataSource: "MANUAL",
        sourceRef: null,
      });

      const manualEditAfterDetach = await setBlockEntryResponse(
        entry.id,
        fixture.tenant.id,
        {
          year: 2024,
          numericValue: 104,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(manualEditAfterDetach).toMatchObject({ status: "success" });
    });
  });

  test("imports filtered relational table data across accreditation workspaces", async () => {
    await withIsolatedDb(async (tracker) => {
      const context = await createEnabledTenantAccreditationContext(tracker);

      const naacBody = await createTenantAccreditationBody(
        context.tenant.id,
        {
          code: `NAAC_${Date.now()}`,
          name: "NAAC Framework",
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(naacBody).toMatchObject({ status: "success" });
      if (naacBody.status !== "success") {
        throw new Error(naacBody.message);
      }

      const naacVersion = await createTenantBodyVersion(
        context.tenant.id,
        naacBody.body.id,
        {
          versionCode: `NAAC_2025_${Date.now()}`,
          versionName: "NAAC 2025",
          scoreBase: 100,
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(naacVersion).toMatchObject({ status: "success" });
      if (naacVersion.status !== "success") {
        throw new Error(naacVersion.message);
      }

      const naacProfile = await createTenantVersionProfile(
        context.tenant.id,
        naacVersion.version.id,
        {
          profileCode: "NAAC_UNIVERSITY",
          profileName: "NAAC University",
          isDefault: true,
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(naacProfile).toMatchObject({ status: "success" });
      if (naacProfile.status !== "success") {
        throw new Error(naacProfile.message);
      }

      const naacCriterion = await createTenantVersionBlock(
        context.tenant.id,
        naacVersion.version.id,
        {
          blockCode: "3.2.2",
          title: "Publications per teacher",
          dataType: CriterionDataType.QUANTITATIVE,
          maxScore: 20,
          isLeaf: true,
          sortOrder: 0,
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(naacCriterion).toMatchObject({ status: "success" });
      if (naacCriterion.status !== "success") {
        throw new Error(naacCriterion.message);
      }

      const nirfBody = await createTenantAccreditationBody(
        context.tenant.id,
        {
          code: `NIRF_${Date.now()}`,
          name: "NIRF Framework",
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(nirfBody).toMatchObject({ status: "success" });
      if (nirfBody.status !== "success") {
        throw new Error(nirfBody.message);
      }

      const nirfVersion = await createTenantBodyVersion(
        context.tenant.id,
        nirfBody.body.id,
        {
          versionCode: `NIRF_2025_${Date.now()}`,
          versionName: "NIRF 2025",
          scoreBase: 100,
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(nirfVersion).toMatchObject({ status: "success" });
      if (nirfVersion.status !== "success") {
        throw new Error(nirfVersion.message);
      }

      const nirfProfile = await createTenantVersionProfile(
        context.tenant.id,
        nirfVersion.version.id,
        {
          profileCode: "NIRF_ENGINEERING",
          profileName: "NIRF Engineering",
          isDefault: true,
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(nirfProfile).toMatchObject({ status: "success" });
      if (nirfProfile.status !== "success") {
        throw new Error(nirfProfile.message);
      }

      const nirfCriterion = await createTenantVersionBlock(
        context.tenant.id,
        nirfVersion.version.id,
        {
          blockCode: "RPC-1",
          title: "Publications",
          dataType: CriterionDataType.QUANTITATIVE,
          maxScore: 20,
          isLeaf: true,
          sortOrder: 0,
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(nirfCriterion).toMatchObject({ status: "success" });
      if (nirfCriterion.status !== "success") {
        throw new Error(nirfCriterion.message);
      }

      const naacWorkspace = await createAssessmentWorkspace(
        context.tenant.id,
        {
          versionId: naacVersion.version.id,
          profileId: naacProfile.profile.id,
          title: "NAAC 2025 Workspace",
          periodStart: new Date("2024-01-01T00:00:00.000Z"),
          periodEnd: new Date("2024-12-31T00:00:00.000Z"),
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(naacWorkspace).toMatchObject({ status: "success" });
      if (naacWorkspace.status !== "success") {
        throw new Error(naacWorkspace.message);
      }

      const nirfWorkspace = await createAssessmentWorkspace(
        context.tenant.id,
        {
          versionId: nirfVersion.version.id,
          profileId: nirfProfile.profile.id,
          title: "NIRF 2025 Workspace",
          periodStart: new Date("2024-01-01T00:00:00.000Z"),
          periodEnd: new Date("2024-12-31T00:00:00.000Z"),
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(nirfWorkspace).toMatchObject({ status: "success" });
      if (nirfWorkspace.status !== "success") {
        throw new Error(nirfWorkspace.message);
      }

      const sourceEntry = await prisma.blockEntry.findFirstOrThrow({
        where: {
          workspaceId: (naacWorkspace.workspace as { id: string }).id,
          blockId: naacCriterion.block.id,
        },
      });
      const targetEntry = await prisma.blockEntry.findFirstOrThrow({
        where: {
          workspaceId: (nirfWorkspace.workspace as { id: string }).id,
          blockId: nirfCriterion.block.id,
        },
      });

      const sourceResponse = await prisma.blockEntryResponse.create({
        data: {
          entryId: sourceEntry.id,
          scopeKey: "YEAR:2024",
          year: 2024,
          responseData: {},
          dataSource: "MANUAL",
        },
      });

      const tableInstance = await prisma.blockEntryTableInstance.create({
        data: {
          entryId: sourceEntry.id,
          responseId: sourceResponse.id,
          year: 2024,
          scopeKey: "YEAR:2024",
          fieldKey: "publication_list",
          fieldLabel: "Publication List",
          createdByUserId: context.actor.id,
        },
      });

      const cseRowOne = await prisma.blockEntryTableRow.create({
        data: {
          instanceId: tableInstance.id,
          rowIndex: 0,
          rowKey: "pub-1",
          dimensions: { batch: "CSE", department: "CSE" },
          dimensionFingerprint: "{\"batch\":\"CSE\",\"department\":\"CSE\"}",
        },
      });
      const cseRowTwo = await prisma.blockEntryTableRow.create({
        data: {
          instanceId: tableInstance.id,
          rowIndex: 1,
          rowKey: "pub-2",
          dimensions: { batch: "CSE", department: "CSE" },
          dimensionFingerprint: "{\"batch\":\"CSE\",\"department\":\"CSE\"}",
        },
      });
      const eceRow = await prisma.blockEntryTableRow.create({
        data: {
          instanceId: tableInstance.id,
          rowIndex: 2,
          rowKey: "pub-3",
          dimensions: { batch: "ECE", department: "ECE" },
          dimensionFingerprint: "{\"batch\":\"ECE\",\"department\":\"ECE\"}",
        },
      });

      await prisma.blockEntryTableCell.createMany({
        data: [
          { rowId: cseRowOne.id, columnKey: "title", textValue: "Paper A" },
          { rowId: cseRowTwo.id, columnKey: "title", textValue: "Paper B" },
          { rowId: eceRow.id, columnKey: "title", textValue: "Paper C" },
        ],
      });
      await prisma.blockEntryTableInstance.update({
        where: { id: tableInstance.id },
        data: { rowCount: 3 },
      });

      const preview = await previewBlockEntryProjection(
        targetEntry.id,
        context.tenant.id,
        {
          sourceWorkspaceId: (naacWorkspace.workspace as { id: string }).id,
          sourceEntryId: sourceEntry.id,
          sourceTableFieldKey: "publication_list",
          filters: {
            years: [2024],
            dimensions: {
              batch: "CSE",
            },
          },
          transform: {
            mode: "COUNT",
          },
          targetPath: "actualValue",
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(preview).toMatchObject({ status: "success" });
      if (preview.status !== "success") {
        throw new Error(preview.message);
      }
      expect(preview.preview.matches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetYear: 2024,
            materializedNumberValue: 2,
          }),
        ]),
      );

      const applied = await applyBlockEntryProjection(
        targetEntry.id,
        context.tenant.id,
        {
          sourceWorkspaceId: (naacWorkspace.workspace as { id: string }).id,
          sourceEntryId: sourceEntry.id,
          sourceTableFieldKey: "publication_list",
          filters: {
            years: [2024],
            dimensions: {
              batch: "CSE",
            },
          },
          transform: {
            mode: "COUNT",
          },
          targetPath: "actualValue",
        },
        context.actor.id,
        "TENANT_OWNER",
      );
      expect(applied).toMatchObject({ status: "success", appliedCount: 1 });

      const importedYearData = await prisma.blockEntryResponse.findUnique({
        where: {
          entryId_scopeKey: {
            entryId: targetEntry.id,
            scopeKey: "YEAR:2024",
          },
        },
      });
      expect(importedYearData).toMatchObject({
        responseData: expect.objectContaining({
          value: 2,
        }),
        dataSource: "PROJECTED",
      });
    });
  });

  test("rejects live projection cycles between criterion entries", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture({
        tracker,
        criteria: [
          {
            blockCode: "3.1.1",
            title: "Metric A",
            maxScore: 10,
          },
          {
            blockCode: "3.1.2",
            title: "Metric B",
            maxScore: 10,
          },
        ],
        periodStart: new Date("2024-01-01T00:00:00.000Z"),
        periodEnd: new Date("2024-12-31T00:00:00.000Z"),
      });

      const entryA = fixture.entriesByCode.get("3.1.1");
      const entryB = fixture.entriesByCode.get("3.1.2");
      expect(entryA).toBeDefined();
      expect(entryB).toBeDefined();
      if (!entryA || !entryB) {
        throw new Error("Cycle fixture entries were not created.");
      }

      const sourceData = await setBlockEntryResponse(
        entryA.id,
        fixture.tenant.id,
        {
          year: 2024,
          numericValue: 12,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(sourceData).toMatchObject({ status: "success" });

      const firstProjection = await applyBlockEntryProjection(
        entryB.id,
        fixture.tenant.id,
        {
          sourceWorkspaceId: fixture.workspaceId,
          sourceEntryId: entryA.id,
          filters: {
            years: [2024],
          },
          targetPath: "actualValue",
          storageMode: ProjectionStorageMode.LIVE_REFERENCE,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(firstProjection).toMatchObject({ status: "success" });

      const cyclePreview = await previewBlockEntryProjection(
        entryA.id,
        fixture.tenant.id,
        {
          sourceWorkspaceId: fixture.workspaceId,
          sourceEntryId: entryB.id,
          filters: {
            years: [2024],
          },
          targetPath: "actualValue",
          storageMode: ProjectionStorageMode.LIVE_REFERENCE,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(cyclePreview).toMatchObject({
        status: "error",
        message: expect.stringContaining("cycle"),
      });
    });
  });
});
