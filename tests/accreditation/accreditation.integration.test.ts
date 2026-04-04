import { describe, expect, test } from "vitest";
import { TenantServiceCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createAccreditationLink,
  createTenantAccreditationBody,
  createTenantBodyVersion,
  createTenantVersionBlock,
  createTenantVersionProfile,
  listAccreditationLinksForKpi,
  listKpisForBlock,
  listTenantAccreditationBodies,
  setTenantProfileWeights,
  updateTenantBlock,
} from "@/lib/accreditation/service";
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

async function createStructureContext(input: {
  tenantId: string;
  actorUserId: string;
}) {
  const version = await prisma.orgStructureVersion.create({
    data: {
      tenantId: input.tenantId,
      versionNumber: 1,
      name: "Published Structure",
      state: "PUBLISHED",
      createdByUserId: input.actorUserId,
    },
  });

  const unitType = await prisma.orgUnitType.create({
    data: {
      versionId: version.id,
      typeKey: "DEPT",
      internalCategory: "DEPARTMENT_LIKE_UNIT",
      displayLabel: "Department",
      allowRoot: true,
    },
  });

  const unit = await prisma.orgUnit.create({
    data: {
      tenantId: input.tenantId,
      versionId: version.id,
      typeId: unitType.id,
      code: "CSE",
      name: "Computer Science",
      state: "ACTIVE",
    },
  });

  return { version, unit };
}

async function createKpiContext(input: {
  tenantId: string;
  actorUserId: string;
  startingUnitId: string;
}) {
  const period = await prisma.assessmentPeriod.create({
    data: {
      tenantId: input.tenantId,
      name: "AY 2026-27",
      code: `AY_${Date.now()}`,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: new Date("2027-03-31T00:00:00.000Z"),
      state: "OPEN",
      reviewFrequency: "ANNUAL",
      createdByUserId: input.actorUserId,
    },
  });

  const kra = await prisma.kraDefinition.create({
    data: {
      tenantId: input.tenantId,
      periodId: period.id,
      title: "Research and Quality",
      weightage: 100,
      state: "ACTIVE",
      createdByUserId: input.actorUserId,
    },
  });

  const kpiOne = await prisma.kpiDefinition.create({
    data: {
      kraDefinitionId: kra.id,
      title: "Indexed Publications",
      measurementType: "NUMERIC",
      weightage: 50,
      allocationType: "BOTH",
      startingUnitId: input.startingUnitId,
      state: "ACTIVE",
      evidenceRequired: false,
    },
  });

  const kpiTwo = await prisma.kpiDefinition.create({
    data: {
      kraDefinitionId: kra.id,
      title: "Accreditation Action Closure",
      measurementType: "NUMERIC",
      weightage: 50,
      allocationType: "BOTH",
      startingUnitId: input.startingUnitId,
      state: "ACTIVE",
      evidenceRequired: false,
    },
  });

  return { period, kra, kpiOne, kpiTwo };
}

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
      code: "TACC",
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
      versionCode: "2026",
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

describe("accreditation add-on module", () => {
  test("tenant service gating blocks access until accreditation is enabled", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant } = await createTenantActor(tracker, "TENANT_OWNER");

      const beforeEnable = await listTenantAccreditationBodies(tenant.id);
      expect(beforeEnable).toMatchObject({
        status: "error",
      });
      expect(beforeEnable.message).toContain("not enabled");
    });
  });

  test("tenant can build a framework and maintain KPI-to-criterion many-to-many links when enabled", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor, body, version, profile } =
        await createEnabledTenantAccreditationContext(tracker);

      const structure = await createStructureContext({
        tenantId: tenant.id,
        actorUserId: actor.id,
      });
      const { kpiOne, kpiTwo } = await createKpiContext({
        tenantId: tenant.id,
        actorUserId: actor.id,
        startingUnitId: structure.unit.id,
      });

      const groupCriterion = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          blockCode: "CR1",
          title: "Research and Accreditation",
          isLeaf: false,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(groupCriterion).toMatchObject({ status: "success" });
      if (groupCriterion.status !== "success") {
        throw new Error(groupCriterion.message);
      }

      const leafCriterionOne = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: groupCriterion.block.id,
          blockCode: "CR1.1",
          title: "Indexed Publications",
          isLeaf: true,
          maxScore: 30,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(leafCriterionOne).toMatchObject({ status: "success" });
      if (leafCriterionOne.status !== "success") {
        throw new Error(leafCriterionOne.message);
      }

      const leafCriterionTwo = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: groupCriterion.block.id,
          blockCode: "CR1.2",
          title: "Action Items Closed",
          isLeaf: true,
          maxScore: 20,
          sortOrder: 2,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(leafCriterionTwo).toMatchObject({ status: "success" });
      if (leafCriterionTwo.status !== "success") {
        throw new Error(leafCriterionTwo.message);
      }

      const groupLinkRejected = await createAccreditationLink(
        tenant.id,
        kpiOne.id,
        {
          blockId: groupCriterion.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(groupLinkRejected).toMatchObject({
        status: "error",
      });

      const linkOne = await createAccreditationLink(
        tenant.id,
        kpiOne.id,
        {
          blockId: leafCriterionOne.block.id,
          notes: "Primary evidence source",
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(linkOne).toMatchObject({ status: "success" });

      const linkTwo = await createAccreditationLink(
        tenant.id,
        kpiOne.id,
        {
          blockId: leafCriterionTwo.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(linkTwo).toMatchObject({ status: "success" });

      const linkThree = await createAccreditationLink(
        tenant.id,
        kpiTwo.id,
        {
          blockId: leafCriterionOne.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(linkThree).toMatchObject({ status: "success" });

      const duplicateLink = await createAccreditationLink(
        tenant.id,
        kpiOne.id,
        {
          blockId: leafCriterionOne.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(duplicateLink).toMatchObject({
        status: "error",
      });

      const linkedCriteriaForKpi = await listAccreditationLinksForKpi(tenant.id, kpiOne.id);
      expect(linkedCriteriaForKpi).toMatchObject({ status: "success" });
      expect(linkedCriteriaForKpi.links).toHaveLength(2);

      const linkedKpisForCriterion = await listKpisForBlock(
        tenant.id,
        leafCriterionOne.block.id,
      );
      expect(linkedKpisForCriterion).toMatchObject({ status: "success" });
      expect(linkedKpisForCriterion.kpis).toHaveLength(2);

      const availableBodies = await listTenantAccreditationBodies(tenant.id);
      expect(availableBodies).toMatchObject({ status: "success" });
      expect(availableBodies.bodies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: body.id,
            code: "TACC",
          }),
        ]),
      );

      expect(profile.profileCode).toBe("UNIVERSITY");
    });
  });

  test("creating a new default profile clears the previous default for that version", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor, version, profile } = await createEnabledTenantAccreditationContext(tracker);

      const secondDefaultProfile = await createTenantVersionProfile(
        tenant.id,
        version.id,
        {
          profileCode: "COLLEGE",
          profileName: "College",
          isDefault: true,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(secondDefaultProfile).toMatchObject({ status: "success" });
      if (secondDefaultProfile.status !== "success") {
        throw new Error(secondDefaultProfile.message);
      }

      const refreshedProfiles = await prisma.accreditationProfile.findMany({
        where: { versionId: version.id },
        select: {
          id: true,
          profileCode: true,
          isDefault: true,
        },
        orderBy: [{ profileCode: "asc" }],
      });

      expect(refreshedProfiles).toEqual([
        {
          id: secondDefaultProfile.profile.id,
          profileCode: "COLLEGE",
          isDefault: true,
        },
        {
          id: profile.id,
          profileCode: "UNIVERSITY",
          isDefault: false,
        },
      ]);
    });
  });

  test("criterion hierarchy updates reject cycles and keep descendant depths consistent", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor, version } = await createEnabledTenantAccreditationContext(tracker);

      const rootCriterion = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          blockCode: "CR1",
          title: "Root Criterion",
          isLeaf: false,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(rootCriterion).toMatchObject({ status: "success" });
      if (rootCriterion.status !== "success") {
        throw new Error(rootCriterion.message);
      }

      const branchCriterion = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: rootCriterion.block.id,
          blockCode: "CR1.1",
          title: "Branch Criterion",
          isLeaf: false,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(branchCriterion).toMatchObject({ status: "success" });
      if (branchCriterion.status !== "success") {
        throw new Error(branchCriterion.message);
      }

      const leafCriterion = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: branchCriterion.block.id,
          blockCode: "CR1.1.1",
          title: "Leaf Criterion",
          isLeaf: true,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(leafCriterion).toMatchObject({ status: "success" });
      if (leafCriterion.status !== "success") {
        throw new Error(leafCriterion.message);
      }

      const extraRoot = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          blockCode: "CR2",
          title: "Extra Root",
          isLeaf: false,
          sortOrder: 2,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(extraRoot).toMatchObject({ status: "success" });
      if (extraRoot.status !== "success") {
        throw new Error(extraRoot.message);
      }

      const extraBranch = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: extraRoot.block.id,
          blockCode: "CR2.1",
          title: "Extra Branch",
          isLeaf: false,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(extraBranch).toMatchObject({ status: "success" });
      if (extraBranch.status !== "success") {
        throw new Error(extraBranch.message);
      }

      const childUnderLeaf = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          parentId: leafCriterion.block.id,
          blockCode: "CR1.1.1.A",
          title: "Illegal Child",
          isLeaf: true,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(childUnderLeaf).toMatchObject({ status: "error" });
      expect(childUnderLeaf.message).toContain("Leaf criteria");

      const selfParent = await updateTenantBlock(
        tenant.id,
        branchCriterion.block.id,
        {
          parentId: branchCriterion.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(selfParent).toMatchObject({ status: "error" });
      expect(selfParent.message).toContain("own parent");

      const cycleMove = await updateTenantBlock(
        tenant.id,
        rootCriterion.block.id,
        {
          parentId: branchCriterion.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(cycleMove).toMatchObject({ status: "error" });
      expect(cycleMove.message).toContain("descendants");

      const invalidLeafUpdate = await updateTenantBlock(
        tenant.id,
        rootCriterion.block.id,
        {
          isLeaf: true,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(invalidLeafUpdate).toMatchObject({ status: "error" });
      expect(invalidLeafUpdate.message).toContain("child nodes");

      const depthOverflow = await updateTenantBlock(
        tenant.id,
        branchCriterion.block.id,
        {
          parentId: extraBranch.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(depthOverflow).toMatchObject({ status: "error" });
      expect(depthOverflow.message).toContain("maximum depth");

      const validMove = await updateTenantBlock(
        tenant.id,
        branchCriterion.block.id,
        {
          parentId: null,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(validMove).toMatchObject({ status: "success" });

      const refreshedCriteria = await prisma.criterionBlock.findMany({
        where: {
          id: {
            in: [
              rootCriterion.block.id,
              branchCriterion.block.id,
              leafCriterion.block.id,
            ],
          },
        },
        select: {
          id: true,
          parentId: true,
          depth: true,
        },
      });

      expect(refreshedCriteria).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: rootCriterion.block.id,
            parentId: null,
            depth: 0,
          }),
          expect.objectContaining({
            id: branchCriterion.block.id,
            parentId: null,
            depth: 0,
          }),
          expect.objectContaining({
            id: leafCriterion.block.id,
            parentId: branchCriterion.block.id,
            depth: 1,
          }),
        ]),
      );
    });
  });

  test("profile weights stay scoped to the profile version and reject duplicate criteria", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor, body, version, profile } =
        await createEnabledTenantAccreditationContext(tracker);

      const versionOneCriterion = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          blockCode: "CR1",
          title: "Version One Criterion",
          isLeaf: true,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(versionOneCriterion).toMatchObject({ status: "success" });
      if (versionOneCriterion.status !== "success") {
        throw new Error(versionOneCriterion.message);
      }

      const secondVersion = await createTenantBodyVersion(
        tenant.id,
        body.id,
        {
          versionCode: "2027",
          versionName: "Tenant Framework 2027",
          scoreBase: 100,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(secondVersion).toMatchObject({ status: "success" });
      if (secondVersion.status !== "success") {
        throw new Error(secondVersion.message);
      }

      const secondVersionCriterion = await createTenantVersionBlock(
        tenant.id,
        secondVersion.version.id,
        {
          blockCode: "CR2",
          title: "Version Two Criterion",
          isLeaf: true,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(secondVersionCriterion).toMatchObject({ status: "success" });
      if (secondVersionCriterion.status !== "success") {
        throw new Error(secondVersionCriterion.message);
      }

      const crossVersionWeights = await setTenantProfileWeights(
        tenant.id,
        profile.id,
        {
          weights: [
            {
              blockId: secondVersionCriterion.block.id,
              maxScore: 10,
            },
          ],
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(crossVersionWeights).toMatchObject({ status: "error" });
      expect(crossVersionWeights.message).toContain("same accreditation version");

      const duplicateWeights = await setTenantProfileWeights(
        tenant.id,
        profile.id,
        {
          weights: [
            {
              blockId: versionOneCriterion.block.id,
              maxScore: 20,
            },
            {
              blockId: versionOneCriterion.block.id,
              maxScore: 25,
            },
          ],
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(duplicateWeights).toMatchObject({ status: "error" });
      expect(duplicateWeights.message).toContain("Duplicate criterion weight overrides");

      const validWeights = await setTenantProfileWeights(
        tenant.id,
        profile.id,
        {
          weights: [
            {
              blockId: versionOneCriterion.block.id,
              maxScore: 20,
              weightPercent: 40,
            },
          ],
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(validWeights).toMatchObject({ status: "success" });

      const storedWeights = await prisma.accreditationProfileWeight.findMany({
        where: { profileId: profile.id },
        select: {
          blockId: true,
          maxScore: true,
          weightPercent: true,
        },
      });

      expect(storedWeights).toEqual([
        {
          blockId: versionOneCriterion.block.id,
          maxScore: 20,
          weightPercent: 40,
        },
      ]);
    });
  });

  test("kpi links reject duplicates and inactive framework nodes", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor, version } = await createEnabledTenantAccreditationContext(tracker);

      const structure = await createStructureContext({
        tenantId: tenant.id,
        actorUserId: actor.id,
      });
      const { kpiOne, kpiTwo } = await createKpiContext({
        tenantId: tenant.id,
        actorUserId: actor.id,
        startingUnitId: structure.unit.id,
      });

      const leafCriterion = await createTenantVersionBlock(
        tenant.id,
        version.id,
        {
          blockCode: "CR1",
          title: "Linked Criterion",
          isLeaf: true,
          sortOrder: 1,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(leafCriterion).toMatchObject({ status: "success" });
      if (leafCriterion.status !== "success") {
        throw new Error(leafCriterion.message);
      }

      const firstLink = await createAccreditationLink(
        tenant.id,
        kpiOne.id,
        {
          blockId: leafCriterion.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(firstLink).toMatchObject({ status: "success" });

      const duplicateLink = await createAccreditationLink(
        tenant.id,
        kpiOne.id,
        {
          blockId: leafCriterion.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(duplicateLink).toMatchObject({ status: "error" });
      expect(duplicateLink.message).toContain("already linked");

      await prisma.accreditationBodyVersion.update({
        where: { id: version.id },
        data: { isActive: false },
      });

      const inactiveVersionLink = await createAccreditationLink(
        tenant.id,
        kpiTwo.id,
        {
          blockId: leafCriterion.block.id,
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(inactiveVersionLink).toMatchObject({ status: "error" });
      expect(inactiveVersionLink.message).toContain("cannot be linked");
    });
  });
});
