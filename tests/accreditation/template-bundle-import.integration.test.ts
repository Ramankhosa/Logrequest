import { afterEach, describe, expect, test } from "vitest";
import {
  AccreditationScoreConversionType,
  AccreditationScope,
  AccreditationTemplateLifecycleStatus,
  CopilotMode,
  CriterionBlockType,
  CriterionDataType,
  CriterionYearAggregation,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { importSuperadminAccreditationTemplateBundle } from "@/lib/accreditation/template-bundle-import-service";
import { cleanupTrackedData, createTestUser, newDbTracker, type DbTracker } from "../helpers/db";

const cleanupQueue: Array<{ bodyId: string; versionId?: string | null }> = [];

async function cleanupImportedGlobals() {
  while (cleanupQueue.length > 0) {
    const next = cleanupQueue.pop();
    if (!next) {
      continue;
    }

    if (next.versionId) {
      await prisma.auditLog.deleteMany({
        where: {
          targetId: next.versionId,
        },
      });
    }

    await prisma.accreditationBody.deleteMany({
      where: { id: next.bodyId },
    });
  }
}

afterEach(async () => {
  await cleanupImportedGlobals();
});

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

function randomCode(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function buildTemplateBundle(input?: {
  bodyCode?: string;
  versionCode?: string;
  lifecycleStatus?: AccreditationTemplateLifecycleStatus;
}) {
  const bodyCode = input?.bodyCode ?? randomCode("NAAC_TPL");
  const versionCode = input?.versionCode ?? randomCode("V");

  return {
    schemaVersion: "logrequest.accreditation-template-bundle.v1",
    bundleType: "accreditation-template",
    sourceArtifact: {
      preparedBy: "integration-test",
    },
    body: {
      code: bodyCode,
      name: "Integration Test Accreditation Body",
      country: "IN",
      description: "Integration test bundle",
      websiteUrl: "https://example.edu/accreditation",
      scope: AccreditationScope.GLOBAL,
      isActive: true,
    },
    version: {
      versionCode,
      versionName: "Integration Test Version",
      scoreBase: 1000,
      convertedScaleMax: null,
      conversionType: AccreditationScoreConversionType.NONE,
      conversionFactor: null,
      lifecycleStatus: input?.lifecycleStatus ?? AccreditationTemplateLifecycleStatus.DRAFT,
      isActive: true,
      assistantPackKey: "NAAC",
      copilotMode: CopilotMode.DETERMINISTIC_ONLY,
      notes: ["integration test"],
    },
    profiles: [
      {
        profileCode: "UNIVERSITY",
        profileName: "University",
        isDefault: true,
      },
    ],
    blocks: [
      {
        blockCode: "CRITERION_1",
        parentBlockCode: null,
        title: "Criterion 1",
        description: "Root criterion",
        blockType: CriterionBlockType.GROUP,
        dataType: CriterionDataType.HYBRID,
        yearAggregation: CriterionYearAggregation.LATEST,
        maxScore: 100,
        sortOrder: 1,
        validationRules: {
          sourceStatus: "CONFIRMED",
        },
      },
      {
        blockCode: "KI_1.1",
        parentBlockCode: "CRITERION_1",
        title: "Key Indicator 1.1",
        description: "Nested group",
        blockType: CriterionBlockType.GROUP,
        dataType: CriterionDataType.HYBRID,
        yearAggregation: CriterionYearAggregation.LATEST,
        maxScore: 25,
        sortOrder: 1,
      },
      {
        blockCode: "METRIC_1.1.1",
        parentBlockCode: "KI_1.1",
        title: "Metric 1.1.1",
        description: "Leaf metric",
        blockType: CriterionBlockType.METRIC,
        dataType: CriterionDataType.QUANTITATIVE,
        yearAggregation: CriterionYearAggregation.AVERAGE,
        maxScore: 20,
        sortOrder: 1,
        unitOfMeasure: "%",
        inputSchema: {
          officialMetricCode: "1.1.1",
        },
        evidenceSchema: {
          expectedEvidence: ["SSR metric template"],
        },
      },
    ],
    gradeBands: [
      {
        gradeLabel: "A",
        scoreMin: 700,
        scoreMax: 1000,
        outcome: "Top band",
        sortOrder: 1,
      },
      {
        gradeLabel: "B",
        scoreMin: 500,
        scoreMax: 699.99,
        outcome: "Mid band",
        sortOrder: 2,
      },
    ],
    thresholdRules: [
      {
        blockCode: "METRIC_1.1.1",
        thresholdType: "MIN_REQUIRED",
        minValue: 10,
        outcome: "Below minimum",
        description: "Metric threshold",
      },
    ],
  };
}

describe("accreditation template bundle importer", () => {
  test("imports a draft bundle into global accreditation templates", async () => {
    await withIsolatedDb(async (tracker) => {
      const actor = await createTestUser(tracker, {
        firstName: "Super",
        lastName: "Admin",
      });
      await prisma.user.update({
        where: { id: actor.id },
        data: { isSuperadmin: true },
      });

      const bundle = buildTemplateBundle();
      const result = await importSuperadminAccreditationTemplateBundle(bundle, actor.id);

      expect(result).toMatchObject({
        status: "success",
        body: {
          code: bundle.body.code,
        },
        version: {
          versionCode: bundle.version.versionCode,
          lifecycleStatus: AccreditationTemplateLifecycleStatus.DRAFT,
        },
        importedCounts: {
          profileCount: 1,
          blockCount: 3,
          gradeBandCount: 2,
          thresholdRuleCount: 1,
        },
      });
      if (result.status !== "success") {
        throw new Error(result.message);
      }

      cleanupQueue.push({ bodyId: result.body.id, versionId: result.version.id });

      const persistedBody = await prisma.accreditationBody.findUnique({
        where: { id: result.body.id },
        include: {
          versions: {
            include: {
              profiles: true,
              blocks: { orderBy: [{ depth: "asc" }, { sortOrder: "asc" }] },
              gradeBands: { orderBy: { sortOrder: "asc" } },
              thresholdRules: true,
            },
          },
        },
      });

      expect(persistedBody?.scope).toBe(AccreditationScope.GLOBAL);
      expect(persistedBody?.versions).toHaveLength(1);
      expect(persistedBody?.versions[0]?.profiles).toHaveLength(1);
      expect(persistedBody?.versions[0]?.blocks).toHaveLength(3);
      expect(persistedBody?.versions[0]?.gradeBands).toHaveLength(2);
      expect(persistedBody?.versions[0]?.thresholdRules).toHaveLength(1);
      expect(
        persistedBody?.versions[0]?.blocks.map((block) => ({
          code: block.blockCode,
          depth: block.depth,
        })),
      ).toEqual([
        { code: "CRITERION_1", depth: 0 },
        { code: "KI_1.1", depth: 1 },
        { code: "METRIC_1.1.1", depth: 2 },
      ]);
    });
  });

  test("can import and publish a validated bundle", async () => {
    await withIsolatedDb(async (tracker) => {
      const actor = await createTestUser(tracker, {
        firstName: "Publish",
        lastName: "Admin",
      });
      await prisma.user.update({
        where: { id: actor.id },
        data: { isSuperadmin: true },
      });

      const bundle = buildTemplateBundle({
        lifecycleStatus: AccreditationTemplateLifecycleStatus.PUBLISHED,
      });
      const result = await importSuperadminAccreditationTemplateBundle(bundle, actor.id);

      expect(result).toMatchObject({
        status: "success",
        version: {
          lifecycleStatus: AccreditationTemplateLifecycleStatus.PUBLISHED,
        },
      });
      if (result.status !== "success") {
        throw new Error(result.message);
      }

      cleanupQueue.push({ bodyId: result.body.id, versionId: result.version.id });

      const persistedVersion = await prisma.accreditationBodyVersion.findUnique({
        where: { id: result.version.id },
        include: {
          blocks: true,
          gradeBands: true,
          thresholdRules: true,
        },
      });

      expect(persistedVersion?.lifecycleStatus).toBe(
        AccreditationTemplateLifecycleStatus.PUBLISHED,
      );
      expect(persistedVersion?.isLocked).toBe(true);
      expect(persistedVersion?.publishedAt).not.toBeNull();
    });
  });

  test("rejects conflicts when a global body code already exists", async () => {
    await withIsolatedDb(async (tracker) => {
      const actor = await createTestUser(tracker, {
        firstName: "Conflict",
        lastName: "Admin",
      });
      await prisma.user.update({
        where: { id: actor.id },
        data: { isSuperadmin: true },
      });

      const bodyCode = randomCode("NAAC_CONFLICT");
      const existingBody = await prisma.accreditationBody.create({
        data: {
          scope: AccreditationScope.GLOBAL,
          code: bodyCode,
          name: "Existing Body",
          isActive: true,
          createdByUserId: actor.id,
        },
      });
      cleanupQueue.push({ bodyId: existingBody.id });

      const bundle = buildTemplateBundle({ bodyCode });
      const result = await importSuperadminAccreditationTemplateBundle(bundle, actor.id);

      expect(result).toMatchObject({
        status: "error",
      });
      if (result.status === "success") {
        throw new Error("Expected import conflict.");
      }
      expect(result.message).toContain("already exists");
    });
  });
});
