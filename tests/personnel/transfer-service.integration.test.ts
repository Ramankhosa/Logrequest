import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  approveTransfer,
  executeTransfer,
  initiateTransfer,
  reassignDetachedTarget,
} from "@/lib/personnel/transfer-service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestTenant,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

type ActorContext = {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
};

type StructureVersionContext = {
  versionId: string;
  rootUnitId: string;
  sourceUnitId: string;
  targetUnitId: string;
};

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

async function createStructureVersion(input: {
  tenantId: string;
  actorUserId: string;
  versionNumber: number;
  state: "PUBLISHED" | "VALIDATED";
}) {
  const version = await prisma.orgStructureVersion.create({
    data: {
      tenantId: input.tenantId,
      versionNumber: input.versionNumber,
      name: `Version ${input.versionNumber}`,
      state: input.state,
      createdByUserId: input.actorUserId,
    },
  });

  const rootType = await prisma.orgUnitType.create({
    data: {
      versionId: version.id,
      typeKey: "ROOT",
      internalCategory: "ORG_ROOT",
      displayLabel: "Root",
      allowRoot: true,
    },
  });
  const deptType = await prisma.orgUnitType.create({
    data: {
      versionId: version.id,
      typeKey: "DEPT",
      internalCategory: "DEPARTMENT_LIKE_UNIT",
      displayLabel: "Department",
      allowRoot: false,
    },
  });

  const root = await prisma.orgUnit.create({
    data: {
      tenantId: input.tenantId,
      versionId: version.id,
      typeId: rootType.id,
      code: "UNIV",
      name: "University",
      state: "ACTIVE",
    },
  });
  const source = await prisma.orgUnit.create({
    data: {
      tenantId: input.tenantId,
      versionId: version.id,
      typeId: deptType.id,
      code: "CSE",
      name: "Computer Science",
      parentId: root.id,
      level: 1,
      state: "ACTIVE",
    },
  });
  const target = await prisma.orgUnit.create({
    data: {
      tenantId: input.tenantId,
      versionId: version.id,
      typeId: deptType.id,
      code: "EEE",
      name: "Electrical Engineering",
      parentId: root.id,
      level: 1,
      state: "ACTIVE",
    },
  });

  return {
    versionId: version.id,
    rootUnitId: root.id,
    sourceUnitId: source.id,
    targetUnitId: target.id,
  } satisfies StructureVersionContext;
}

async function createTransferFixture(tracker: DbTracker) {
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
  const context: ActorContext = {
    tenantId: tenant.id,
    actorUserId: actor.id,
    actorRole: "TENANT_OWNER",
  };

  const transferredUser = await createTestUser(tracker, {
    firstName: "Transfer",
    lastName: "User",
  });
  const replacementUser = await createTestUser(tracker, {
    firstName: "Replacement",
    lastName: "User",
  });

  const membership = await createTestMembership({
    tenantId: tenant.id,
    userId: transferredUser.id,
    role: "TENANT_USER",
    createdByUserId: actor.id,
  });
  await prisma.membership.update({
    where: { id: membership.id },
    data: {
      personnelStatus: "ACTIVE",
      department: "Computer Science",
    },
  });

  const replacementMembership = await createTestMembership({
    tenantId: tenant.id,
    userId: replacementUser.id,
    role: "TENANT_USER",
    createdByUserId: actor.id,
  });
  await prisma.membership.update({
    where: { id: replacementMembership.id },
    data: {
      personnelStatus: "ACTIVE",
      department: "Computer Science",
    },
  });

  const published = await createStructureVersion({
    tenantId: tenant.id,
    actorUserId: actor.id,
    versionNumber: 1,
    state: "PUBLISHED",
  });
  const validated = await createStructureVersion({
    tenantId: tenant.id,
    actorUserId: actor.id,
    versionNumber: 2,
    state: "VALIDATED",
  });

  await prisma.userOrgAssignment.createMany({
    data: [
      {
        versionId: published.versionId,
        unitId: published.sourceUnitId,
        userId: transferredUser.id,
        assignmentType: "PRIMARY",
        isPrimary: true,
      },
      {
        versionId: validated.versionId,
        unitId: validated.sourceUnitId,
        userId: transferredUser.id,
        assignmentType: "PRIMARY",
        isPrimary: true,
      },
      {
        versionId: published.versionId,
        unitId: published.sourceUnitId,
        userId: replacementUser.id,
        assignmentType: "PRIMARY",
        isPrimary: true,
      },
      {
        versionId: validated.versionId,
        unitId: validated.sourceUnitId,
        userId: replacementUser.id,
        assignmentType: "PRIMARY",
        isPrimary: true,
      },
    ],
  });

  const sourceRole = await prisma.orgRoleDefinition.create({
    data: {
      tenantId: tenant.id,
      roleKey: "FACULTY",
      displayLabel: "Faculty",
      maxPerUnit: -1,
      isActive: true,
    },
  });
  const targetRole = await prisma.orgRoleDefinition.create({
    data: {
      tenantId: tenant.id,
      roleKey: "COORDINATOR",
      displayLabel: "Coordinator",
      maxPerUnit: -1,
      isActive: true,
    },
  });

  await prisma.orgRoleAssignment.createMany({
    data: [
      {
        versionId: published.versionId,
        unitId: published.sourceUnitId,
        userId: transferredUser.id,
        roleDefinitionId: sourceRole.id,
        roleName: sourceRole.displayLabel,
        scope: "NODE",
      },
      {
        versionId: validated.versionId,
        unitId: validated.sourceUnitId,
        userId: transferredUser.id,
        roleDefinitionId: sourceRole.id,
        roleName: sourceRole.displayLabel,
        scope: "NODE",
      },
    ],
  });

  const period = await prisma.assessmentPeriod.create({
    data: {
      tenantId: tenant.id,
      name: "AY 2026-27",
      code: `AY${Date.now()}`,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: new Date("2027-03-31T00:00:00.000Z"),
      state: "OPEN",
      reviewFrequency: "ANNUAL",
      createdByUserId: actor.id,
    },
  });

  const kra = await prisma.kraDefinition.create({
    data: {
      tenantId: tenant.id,
      periodId: period.id,
      title: "Research",
      weightage: 100,
      state: "ACTIVE",
      createdByUserId: actor.id,
    },
  });

  const kpi = await prisma.kpiDefinition.create({
    data: {
      kraDefinitionId: kra.id,
      title: "Journal Publications",
      measurementType: "NUMERIC",
      weightage: 100,
      allocationType: "BOTH",
      startingUnitId: published.sourceUnitId,
      state: "ACTIVE",
      evidenceRequired: false,
    },
  });

  return {
    tenant,
    actor,
    context,
    membership,
    transferredUser,
    replacementUser,
    replacementMembership,
    published,
    validated,
    targetRole,
    period,
    kpi,
  };
}

describe("transfer-service integration", () => {
  test("auto-approves transfer when tenant policy disables approval", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createTransferFixture(tracker);

      await prisma.tenantPersonnelPolicy.create({
        data: {
          tenantId: fixture.tenant.id,
          requireTransferApproval: false,
        },
      });

      const result = await initiateTransfer({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: fixture.context.actorRole,
        values: {
          membershipId: fixture.membership.id,
          sourceUnitId: fixture.validated.sourceUnitId,
          targetUnitId: fixture.validated.targetUnitId,
          effectiveDate: new Date("2026-06-01T00:00:00.000Z"),
          newRoleDefinitionIds: [fixture.targetRole.id],
          kpiTransferPolicy: "CARRY_ALL",
        },
      });

      expect(result.status).toBe("success");

      const transfer = await prisma.transferRecord.findUniqueOrThrow({
        where: { id: result.transferId! },
        include: {
          statusEvents: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      expect(transfer.status).toBe("APPROVED");
      expect(transfer.sourceUnitId).toBe(fixture.published.sourceUnitId);
      expect(transfer.targetUnitId).toBe(fixture.published.targetUnitId);
      expect(transfer.statusEvents.map((event) => event.eventType)).toEqual([
        "INITIATED",
        "CONFIGURED",
        "APPROVED",
      ]);
    });
  });

  test("executes carry transfer across published and validated versions while keeping locked targets at source", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createTransferFixture(tracker);

      const activeAllocation = await prisma.targetAllocation.create({
        data: {
          tenantId: fixture.tenant.id,
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          assignedToUserId: fixture.transferredUser.id,
          allocatedByUserId: fixture.actor.id,
          targetValue: 10,
          state: "ACTIVE",
        },
      });
      const lockedAllocation = await prisma.targetAllocation.create({
        data: {
          tenantId: fixture.tenant.id,
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          assignedToUserId: fixture.transferredUser.id,
          allocatedByUserId: fixture.actor.id,
          targetValue: 3,
          state: "LOCKED",
          lockedAt: new Date("2026-12-01T00:00:00.000Z"),
        },
      });

      const achievement = await prisma.achievement.create({
        data: {
          tenantId: fixture.tenant.id,
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          targetAllocationId: activeAllocation.id,
          reportedByUserId: fixture.transferredUser.id,
          evidenceLinks: [],
          actualValue: 5,
          state: "SUBMITTED",
          currentVerifierUnitId: fixture.published.sourceUnitId,
        },
      });

      const initiated = await initiateTransfer({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: fixture.context.actorRole,
        values: {
          membershipId: fixture.membership.id,
          sourceUnitId: fixture.validated.sourceUnitId,
          targetUnitId: fixture.validated.targetUnitId,
          effectiveDate: new Date("2026-06-01T00:00:00.000Z"),
          newRoleDefinitionIds: [fixture.targetRole.id],
          kpiTransferPolicy: "CARRY_ALL",
        },
      });
      expect(initiated.status).toBe("success");

      const approved = await approveTransfer({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: fixture.context.actorRole,
        transferId: initiated.transferId!,
      });
      expect(approved.status).toBe("success");

      const executed = await executeTransfer({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: fixture.context.actorRole,
        transferId: initiated.transferId!,
      });
      expect(executed.status).toBe("success");

      const [publishedAssignment, validatedAssignment] = await Promise.all([
        prisma.userOrgAssignment.findFirst({
          where: {
            versionId: fixture.published.versionId,
            userId: fixture.transferredUser.id,
            isPrimary: true,
          },
        }),
        prisma.userOrgAssignment.findFirst({
          where: {
            versionId: fixture.validated.versionId,
            userId: fixture.transferredUser.id,
            isPrimary: true,
          },
        }),
      ]);

      expect(publishedAssignment?.unitId).toBe(fixture.published.targetUnitId);
      expect(validatedAssignment?.unitId).toBe(fixture.validated.targetUnitId);

      const [activeAfter, lockedAfter, achievementAfter, targetRoles] = await Promise.all([
        prisma.targetAllocation.findUniqueOrThrow({ where: { id: activeAllocation.id } }),
        prisma.targetAllocation.findUniqueOrThrow({ where: { id: lockedAllocation.id } }),
        prisma.achievement.findUniqueOrThrow({ where: { id: achievement.id } }),
        prisma.orgRoleAssignment.findMany({
          where: {
            userId: fixture.transferredUser.id,
            roleDefinitionId: fixture.targetRole.id,
            isActive: true,
          },
        }),
      ]);

      expect(activeAfter.assignedToUserId).toBe(fixture.transferredUser.id);
      expect(activeAfter.assignedToUnitId).toBeNull();
      expect(lockedAfter.assignedToUserId).toBeNull();
      expect(lockedAfter.assignedToUnitId).toBe(fixture.published.sourceUnitId);
      expect(achievementAfter.currentVerifierUnitId).toBe(fixture.published.sourceUnitId);
      expect(targetRoles).toHaveLength(2);
    });
  });

  test("leaves active targets behind and allows reassignment only to a source-unit member", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createTransferFixture(tracker);

      const activeAllocation = await prisma.targetAllocation.create({
        data: {
          tenantId: fixture.tenant.id,
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          assignedToUserId: fixture.transferredUser.id,
          allocatedByUserId: fixture.actor.id,
          targetValue: 7,
          state: "ACTIVE",
        },
      });

      const initiated = await initiateTransfer({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: fixture.context.actorRole,
        values: {
          membershipId: fixture.membership.id,
          sourceUnitId: fixture.published.sourceUnitId,
          targetUnitId: fixture.published.targetUnitId,
          effectiveDate: new Date("2026-06-01T00:00:00.000Z"),
          newRoleDefinitionIds: [fixture.targetRole.id],
          kpiTransferPolicy: "LEAVE_ALL",
        },
      });

      await approveTransfer({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: fixture.context.actorRole,
        transferId: initiated.transferId!,
      });
      await executeTransfer({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: fixture.context.actorRole,
        transferId: initiated.transferId!,
      });

      const detached = await prisma.targetAllocation.findUniqueOrThrow({
        where: { id: activeAllocation.id },
      });
      expect(detached.assignedToUserId).toBeNull();
      expect(detached.assignedToUnitId).toBe(fixture.published.sourceUnitId);

      const reassigned = await reassignDetachedTarget({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: fixture.context.actorRole,
        values: {
          transferId: initiated.transferId!,
          targetAllocationId: activeAllocation.id,
          newUserId: fixture.replacementUser.id,
        },
      });

      expect(reassigned.status).toBe("success");

      const afterReassign = await prisma.targetAllocation.findUniqueOrThrow({
        where: { id: activeAllocation.id },
      });
      expect(afterReassign.assignedToUserId).toBe(fixture.replacementUser.id);
      expect(afterReassign.assignedToUnitId).toBeNull();
    });
  });

  test("allows only one concurrent execution attempt to succeed", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createTransferFixture(tracker);

      await prisma.targetAllocation.create({
        data: {
          tenantId: fixture.tenant.id,
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          assignedToUserId: fixture.transferredUser.id,
          allocatedByUserId: fixture.actor.id,
          targetValue: 9,
          state: "ACTIVE",
        },
      });

      const initiated = await initiateTransfer({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: fixture.context.actorRole,
        values: {
          membershipId: fixture.membership.id,
          sourceUnitId: fixture.published.sourceUnitId,
          targetUnitId: fixture.published.targetUnitId,
          effectiveDate: new Date("2026-06-01T00:00:00.000Z"),
          newRoleDefinitionIds: [fixture.targetRole.id],
          kpiTransferPolicy: "CARRY_ALL",
        },
      });
      await approveTransfer({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: fixture.context.actorRole,
        transferId: initiated.transferId!,
      });

      const [first, second] = await Promise.all([
        executeTransfer({
          tenantId: fixture.tenant.id,
          actorUserId: fixture.actor.id,
          actorRole: fixture.context.actorRole,
          transferId: initiated.transferId!,
        }),
        executeTransfer({
          tenantId: fixture.tenant.id,
          actorUserId: fixture.actor.id,
          actorRole: fixture.context.actorRole,
          transferId: initiated.transferId!,
        }),
      ]);

      expect([first.status, second.status].sort()).toEqual(["error", "success"]);

      const transfer = await prisma.transferRecord.findUniqueOrThrow({
        where: { id: initiated.transferId! },
      });
      expect(transfer.status).toBe("COMPLETED");
    });
  });
});
