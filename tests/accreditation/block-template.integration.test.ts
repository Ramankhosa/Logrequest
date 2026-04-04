import {
  AccreditationScope,
  AccreditationTemplateLifecycleStatus,
  CriterionDataType,
  CriterionBlockType,
  CriterionYearAggregation,
  TenantServiceCode,
} from "@prisma/client";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createTenantAccreditationBody,
  createTenantBodyVersion,
  createTenantVersionProfile,
} from "@/lib/accreditation/service";
import {
  createTenantVersionBlock,
  forkGlobalVersionToTenantDraft,
  listTenantVersionBlocks,
  publishTenantVersionBlocks,
  updateTenantVersionBlock,
  validateTenantVersionBlocks,
} from "@/lib/accreditation/block-template-service";
import { createAssessmentWorkspace } from "@/lib/accreditation/workspace-service";
import {
  cleanupTrackedData,
  createTenantActor,
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

async function createEnabledTenantTemplateContext(tracker: DbTracker) {
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");

  await enableTenantService({
    tenantId: tenant.id,
    serviceCode: TenantServiceCode.ACCREDITATION,
    actorUserId: actor.id,
  });

  const bodyResult = await createTenantAccreditationBody(
    tenant.id,
    {
      code: "TBLK",
      name: "Tenant Block Framework",
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
      versionCode: "2026-DRAFT",
      versionName: "Tenant Block Draft 2026",
      scoreBase: 100,
      lifecycleStatus: AccreditationTemplateLifecycleStatus.DRAFT,
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

describe("accreditation block-authored templates", () => {
  test("draft block templates validate, publish into criteria, and gate workspace creation until published", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor, version, profile } = await createEnabledTenantTemplateContext(tracker);

      const rootBlock = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          blockCode: "CR1",
          blockType: CriterionBlockType.GROUP,
          title: "Research",
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(rootBlock).toMatchObject({ status: "success" });
      if (rootBlock.status !== "success") {
        throw new Error(rootBlock.message);
      }

      const leafBlock = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: rootBlock.block.id,
          blockCode: "CR1.1",
          blockType: CriterionBlockType.METRIC,
          title: "Indexed Publications",
          maxScore: 20,
          sortOrder: 1,
          scoringRule: {
            type: "SLAB",
            slabs: [
              { min: null, max: 10, label: "Low", points: 5 },
              { min: 10, max: null, label: "Strong", points: 20 },
            ],
          },
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(leafBlock).toMatchObject({ status: "success" });

      const draftWorkspace = await createAssessmentWorkspace(
        tenant.id,
        {
          versionId: version.id,
          profileId: profile.id,
          title: "Draft Workspace",
          periodStart: new Date("2025-06-01T00:00:00.000Z"),
          periodEnd: new Date("2026-05-31T00:00:00.000Z"),
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(draftWorkspace).toMatchObject({ status: "error" });
      expect(draftWorkspace.message).toContain("published");

      const validateResult = await validateTenantVersionBlocks(
        tenant.id,
        version.id,
        actor.id,
        "TENANT_OWNER",
      );
      expect(validateResult).toMatchObject({ status: "success" });

      const blocksBeforePublish = await listTenantVersionBlocks(tenant.id, version.id);
      expect(blocksBeforePublish.status).toBe("success");

      const publishResult = await publishTenantVersionBlocks(
        tenant.id,
        version.id,
        actor.id,
        "TENANT_OWNER",
      );
      expect(publishResult).toMatchObject({ status: "success", publishedBlockCount: 2 });

      const blocksAfterPublish = await listTenantVersionBlocks(tenant.id, version.id);
      expect(blocksAfterPublish.status).toBe("success");
      if (blocksAfterPublish.status !== "success") {
        throw new Error(blocksAfterPublish.message);
      }
      expect(blocksAfterPublish.blocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            blockCode: "CR1",
            children: expect.arrayContaining([
              expect.objectContaining({
                blockCode: "CR1.1",
                isLeaf: true,
              }),
            ]),
          }),
        ]),
      );

      const updatePublished = await updateTenantVersionBlock(
        tenant.id,
        leafBlock.status === "success" ? leafBlock.block.id : "",
        {
          title: "Should fail after publish",
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(updatePublished).toMatchObject({ status: "error" });
      expect(updatePublished.message).toContain("Published versions");

      const publishedWorkspace = await createAssessmentWorkspace(
        tenant.id,
        {
          versionId: version.id,
          profileId: profile.id,
          title: "Published Workspace",
          periodStart: new Date("2025-06-01T00:00:00.000Z"),
          periodEnd: new Date("2026-05-31T00:00:00.000Z"),
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(publishedWorkspace).toMatchObject({ status: "success" });
    });
  });

  test("tenant can fork a published global template into a tenant draft block version", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
      await enableTenantService({
        tenantId: tenant.id,
        serviceCode: TenantServiceCode.ACCREDITATION,
        actorUserId: actor.id,
      });

      const globalBody = await prisma.accreditationBody.create({
        data: {
          scope: AccreditationScope.GLOBAL,
          code: "GNAAC",
          name: "Global NAAC",
          isActive: true,
        },
      });
      let globalVersionId: string | null = null;
      let globalBlockIds: string[] = [];

      try {
        const globalVersion = await prisma.accreditationBodyVersion.create({
          data: {
            bodyId: globalBody.id,
            versionCode: "2025",
            versionName: "NAAC 2025",
            scoreBase: 100,
            lifecycleStatus: AccreditationTemplateLifecycleStatus.PUBLISHED,
            publishedAt: new Date(),
          },
        });
        globalVersionId = globalVersion.id;

        const root = await prisma.criterionBlock.create({
          data: {
            versionId: globalVersion.id,
            blockCode: "1",
            lineageKey: "1",
            blockType: CriterionBlockType.GROUP,
            isLeaf: false,
            isSectionRoot: true,
            title: "Curricular Aspects",
            depth: 0,
            sortOrder: 1,
          },
        });
        globalBlockIds.push(root.id);

        const leaf = await prisma.criterionBlock.create({
          data: {
            versionId: globalVersion.id,
            parentId: root.id,
            blockCode: "1.1",
            lineageKey: "1.1",
            blockType: CriterionBlockType.METRIC,
            isLeaf: true,
            title: "CBCS Coverage",
            depth: 1,
            sortOrder: 1,
            maxScore: 15,
          },
        });
        globalBlockIds.push(leaf.id);

        await prisma.accreditationProfile.create({
          data: {
            versionId: globalVersion.id,
            profileCode: "UNIVERSITY",
            profileName: "University",
            isDefault: true,
          },
        });

        const forkResult = await forkGlobalVersionToTenantDraft(
          tenant.id,
          globalVersion.id,
          actor.id,
          "TENANT_OWNER",
        );
        expect(forkResult).toMatchObject({ status: "success", blockCount: 2 });
        if (forkResult.status !== "success") {
          throw new Error(forkResult.message);
        }

        const blocks = await listTenantVersionBlocks(tenant.id, forkResult.version.id);
        expect(blocks.status).toBe("success");
        if (blocks.status !== "success") {
          throw new Error(blocks.message);
        }

        expect(blocks.version).toMatchObject({
          lifecycleStatus: AccreditationTemplateLifecycleStatus.DRAFT,
          scope: AccreditationScope.TENANT,
        });
        expect(blocks.blocks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              blockCode: "1",
              children: expect.arrayContaining([
                expect.objectContaining({
                  blockCode: "1.1",
                }),
              ]),
            }),
          ]),
        );
      } finally {
        await prisma.auditLog.deleteMany({
          where: {
            targetType: { in: ["AccreditationBodyVersion", "CriterionBlock", "AccreditationBody"] },
            targetId: {
              in: [globalBody.id, ...(globalVersionId ? [globalVersionId] : []), ...globalBlockIds],
            },
          },
        });
        await prisma.accreditationBody.deleteMany({
          where: { id: globalBody.id },
        });
      }
    });
  });

  test("validation rejects dependency cycles and unknown block references", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor, version } = await createEnabledTenantTemplateContext(tracker);

      const rootBlock = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          blockCode: "CR1",
          blockType: CriterionBlockType.GROUP,
          title: "Research",
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(rootBlock).toMatchObject({ status: "success" });
      if (rootBlock.status !== "success") {
        throw new Error(rootBlock.message);
      }

      const firstLeaf = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: rootBlock.block.id,
          blockCode: "CR1.1",
          blockType: CriterionBlockType.METRIC,
          title: "Publications",
          maxScore: 20,
          sortOrder: 1,
          dependencyRules: [{ targetBlockCode: "CR1.2" }],
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(firstLeaf).toMatchObject({ status: "success" });

      const secondLeaf = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: rootBlock.block.id,
          blockCode: "CR1.2",
          blockType: CriterionBlockType.METRIC,
          title: "Projects",
          maxScore: 10,
          sortOrder: 2,
          dependencyRules: [{ targetBlockCode: "CR1.1" }],
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(secondLeaf).toMatchObject({ status: "success" });

      const cycleValidation = await validateTenantVersionBlocks(
        tenant.id,
        version.id,
        actor.id,
        "TENANT_OWNER",
      );
      expect(cycleValidation).toMatchObject({ status: "error" });
      expect(cycleValidation.message).toContain("acyclic");

      const breakCycle = await updateTenantVersionBlock(
        tenant.id,
        secondLeaf.status === "success" ? secondLeaf.block.id : "",
        {
          dependencyRules: [{ targetBlockCode: "CR1.999" }],
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(breakCycle).toMatchObject({ status: "success" });

      const missingValidation = await validateTenantVersionBlocks(
        tenant.id,
        version.id,
        actor.id,
        "TENANT_OWNER",
      );
      expect(missingValidation).toMatchObject({ status: "error" });
      expect(missingValidation.message).toContain("unknown block");
    });
  });

  test("block hierarchy edits reject illegal parent and depth changes", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor, version } = await createEnabledTenantTemplateContext(tracker);

      const rootBlock = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          blockCode: "CR1",
          blockType: CriterionBlockType.GROUP,
          title: "Research",
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(rootBlock).toMatchObject({ status: "success" });
      if (rootBlock.status !== "success") {
        throw new Error(rootBlock.message);
      }

      const childGroup = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: rootBlock.block.id,
          blockCode: "CR1.1",
          blockType: CriterionBlockType.GROUP,
          title: "Research Output",
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(childGroup).toMatchObject({ status: "success" });
      if (childGroup.status !== "success") {
        throw new Error(childGroup.message);
      }

      const grandchildGroup = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: childGroup.block.id,
          blockCode: "CR1.1.1",
          blockType: CriterionBlockType.GROUP,
          title: "Indexed Publications",
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(grandchildGroup).toMatchObject({ status: "success" });
      if (grandchildGroup.status !== "success") {
        throw new Error(grandchildGroup.message);
      }

      const fourthLevel = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: grandchildGroup.block.id,
          blockCode: "CR1.1.1.1",
          blockType: CriterionBlockType.METRIC,
          title: "Too Deep",
          maxScore: 5,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(fourthLevel).toMatchObject({ status: "error" });
      expect(fourthLevel.message).toContain("maximum depth");

      const convertParentToLeaf = await updateTenantVersionBlock(
        tenant.id,
        childGroup.block.id,
        {
          blockType: CriterionBlockType.METRIC,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(convertParentToLeaf).toMatchObject({ status: "error" });
      expect(convertParentToLeaf.message).toContain("child nodes");

      const moveParentUnderDescendant = await updateTenantVersionBlock(
        tenant.id,
        childGroup.block.id,
        {
          parentId: grandchildGroup.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(moveParentUnderDescendant).toMatchObject({ status: "error" });
      expect(moveParentUnderDescendant.message).toContain("descendants");
    });
  });

  test("publish rejects drafts without an active metric or qualitative leaf block", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor, version } = await createEnabledTenantTemplateContext(tracker);

      const rootBlock = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          blockCode: "CR1",
          blockType: CriterionBlockType.GROUP,
          title: "Research",
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(rootBlock).toMatchObject({ status: "success" });

      const publishResult = await publishTenantVersionBlocks(
        tenant.id,
        version.id,
        actor.id,
        "TENANT_OWNER",
      );
      expect(publishResult).toMatchObject({ status: "error" });
      expect(publishResult.message).toContain("metric or qualitative leaf");
    });
  });

  test("fork rejects unpublished global versions and copies published global blocks into a tenant draft", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
      await enableTenantService({
        tenantId: tenant.id,
        serviceCode: TenantServiceCode.ACCREDITATION,
        actorUserId: actor.id,
      });

      const globalBody = await prisma.accreditationBody.create({
        data: {
          scope: AccreditationScope.GLOBAL,
          code: "LEGACYG",
          name: "Legacy Global Framework",
          isActive: true,
        },
      });
      let draftVersionId: string | null = null;
      let publishedVersionId: string | null = null;
      let globalBlockIds: string[] = [];

      try {
        const draftVersion = await prisma.accreditationBodyVersion.create({
          data: {
            bodyId: globalBody.id,
            versionCode: "2025-DRAFT",
            versionName: "Legacy 2025 Draft",
            scoreBase: 100,
            lifecycleStatus: AccreditationTemplateLifecycleStatus.DRAFT,
          },
        });
        draftVersionId = draftVersion.id;

        const rejectedFork = await forkGlobalVersionToTenantDraft(
          tenant.id,
          draftVersion.id,
          actor.id,
          "TENANT_OWNER",
        );
        expect(rejectedFork).toMatchObject({ status: "error" });
        expect(rejectedFork.message).toContain("Published global template version not found");

        const publishedVersion = await prisma.accreditationBodyVersion.create({
          data: {
            bodyId: globalBody.id,
            versionCode: "2025",
            versionName: "Legacy 2025",
            scoreBase: 100,
            lifecycleStatus: AccreditationTemplateLifecycleStatus.PUBLISHED,
            publishedAt: new Date(),
          },
        });
        publishedVersionId = publishedVersion.id;

        const rootCriterion = await prisma.criterionBlock.create({
          data: {
            versionId: publishedVersion.id,
            blockCode: "1",
            lineageKey: "1",
            blockType: CriterionBlockType.GROUP,
            title: "Curricular Aspects",
            dataType: CriterionDataType.QUANTITATIVE,
            yearAggregation: CriterionYearAggregation.AVERAGE,
            isLeaf: false,
            isSectionRoot: true,
            sortOrder: 1,
            depth: 0,
          },
        });
        globalBlockIds.push(rootCriterion.id);

        const leafCriterion = await prisma.criterionBlock.create({
          data: {
            versionId: publishedVersion.id,
            parentId: rootCriterion.id,
            blockCode: "1.1",
            lineageKey: "1.1",
            blockType: CriterionBlockType.METRIC,
            title: "CBCS Coverage",
            dataType: CriterionDataType.QUANTITATIVE,
            yearAggregation: CriterionYearAggregation.AVERAGE,
            maxScore: 15,
            isLeaf: true,
            sortOrder: 1,
            depth: 1,
          },
        });
        globalBlockIds.push(leafCriterion.id);

        await prisma.accreditationProfile.create({
          data: {
            versionId: publishedVersion.id,
            profileCode: "UNIVERSITY",
            profileName: "University",
            isDefault: true,
          },
        });

        const forkResult = await forkGlobalVersionToTenantDraft(
          tenant.id,
          publishedVersion.id,
          actor.id,
          "TENANT_OWNER",
        );
        expect(forkResult).toMatchObject({ status: "success", blockCount: 2 });
        if (forkResult.status !== "success") {
          throw new Error(forkResult.message);
        }

        const blocks = await listTenantVersionBlocks(tenant.id, forkResult.version.id);
        expect(blocks.status).toBe("success");
        if (blocks.status !== "success") {
          throw new Error(blocks.message);
        }

        expect(blocks.blocks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              blockCode: "1",
              children: expect.arrayContaining([
                expect.objectContaining({
                  blockCode: "1.1",
                  blockType: CriterionBlockType.METRIC,
                  scoringRule: null,
                }),
              ]),
            }),
          ]),
        );
      } finally {
        await prisma.auditLog.deleteMany({
          where: {
            targetType: { in: ["AccreditationBodyVersion", "CriterionBlock", "AccreditationBody"] },
            targetId: {
              in: [globalBody.id, ...(draftVersionId ? [draftVersionId] : []), ...(publishedVersionId ? [publishedVersionId] : []), ...globalBlockIds],
            },
          },
        });
        await prisma.accreditationBody.deleteMany({
          where: { id: globalBody.id },
        });
      }
    });
  });
});
