import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserLifecycleState } from "@prisma/client";
import { hash } from "bcryptjs";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = "postgresql://postgres:123@localhost:5432/logrequest";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo@12345";

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

async function upsertUser({
  email,
  firstName,
  lastName,
  password,
  isSuperadmin = false,
}) {
  const passwordHash = await hash(password, 12);

  return prisma.user.upsert({
    where: {
      officialEmail: email.toLowerCase(),
    },
    update: {
      firstName,
      lastName,
      isSuperadmin,
      lifecycleState: UserLifecycleState.ACTIVE,
      passwordHash,
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
      allowedLoginMethods: ["PASSWORD", "GOOGLE", "MICROSOFT"],
      mustResetPassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      firstName,
      lastName,
      officialEmail: email.toLowerCase(),
      isSuperadmin,
      lifecycleState: UserLifecycleState.ACTIVE,
      passwordHash,
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
      allowedLoginMethods: ["PASSWORD", "GOOGLE", "MICROSOFT"],
      mustResetPassword: false,
    },
  });
}

async function ensureMembership({
  tenantId,
  userId,
  role,
  createdByUserId,
  employeeId,
  designation,
}) {
  return prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId,
        userId,
      },
    },
    update: {
      role,
      employeeId,
      designation,
      status: "ACTIVE",
      invitationState: "ACCEPTED",
      personnelStatus: "ACTIVE",
      createdByUserId,
      activationTimestamp: new Date(),
    },
    create: {
      tenantId,
      userId,
      role,
      employeeId,
      designation,
      status: "ACTIVE",
      invitationState: "ACCEPTED",
      personnelStatus: "ACTIVE",
      createdByUserId,
      activationTimestamp: new Date(),
    },
  });
}

async function ensurePrimaryUnitAssignment({ versionId, unitId, userId }) {
  await prisma.userOrgAssignment.updateMany({
    where: {
      versionId,
      userId,
      isPrimary: true,
      unitId: { not: unitId },
    },
    data: {
      assignmentType: "SECONDARY",
      isPrimary: false,
    },
  });

  const existingAssignment = await prisma.userOrgAssignment.findFirst({
    where: {
      versionId,
      unitId,
      userId,
    },
  });

  if (existingAssignment) {
    return prisma.userOrgAssignment.update({
      where: { id: existingAssignment.id },
      data: {
        assignmentType: "PRIMARY",
        isPrimary: true,
        effectiveTo: null,
        effectiveFrom: existingAssignment.effectiveFrom ?? new Date(),
      },
    });
  }

  return prisma.userOrgAssignment.create({
    data: {
      versionId,
      unitId,
      userId,
      assignmentType: "PRIMARY",
      isPrimary: true,
      effectiveFrom: new Date(),
    },
  });
}

async function ensurePublishedStructure(tenantId, actorUserId) {
  const existing = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: "PUBLISHED",
    },
    include: {
      units: true,
    },
  });
  if (existing) {
    return {
      version: existing,
      rootUnit: existing.units.find((unit) => unit.code === "UNIV"),
      cseUnit: existing.units.find((unit) => unit.code === "CSE"),
      eceUnit: existing.units.find((unit) => unit.code === "ECE"),
    };
  }

  const versionNumber =
    (await prisma.orgStructureVersion.aggregate({
      where: { tenantId },
      _max: { versionNumber: true },
    }))._max.versionNumber ?? 0;

  const version = await prisma.orgStructureVersion.create({
    data: {
      tenantId,
      name: "Seed Structure v1",
      versionNumber: versionNumber + 1,
      state: "PUBLISHED",
      validatedAt: new Date(),
      publishedAt: new Date(),
      createdByUserId: actorUserId,
    },
  });

  const rootType = await prisma.orgUnitType.create({
    data: {
      versionId: version.id,
      typeKey: "ROOT",
      internalCategory: "ORG_ROOT",
      displayLabel: "Root",
      allowRoot: true,
      sortOrder: 0,
    },
  });

  const deptType = await prisma.orgUnitType.create({
    data: {
      versionId: version.id,
      typeKey: "DEPT",
      internalCategory: "DEPARTMENT_LIKE_UNIT",
      displayLabel: "Department",
      allowRoot: false,
      sortOrder: 1,
    },
  });

  const rootUnit = await prisma.orgUnit.create({
    data: {
      tenantId,
      versionId: version.id,
      typeId: rootType.id,
      code: "UNIV",
      name: "Demo University",
      level: 0,
      sortOrder: 0,
      path: "UNIV",
      state: "ACTIVE",
      createdByUserId: actorUserId,
    },
  });

  const cseUnit = await prisma.orgUnit.create({
    data: {
      tenantId,
      versionId: version.id,
      typeId: deptType.id,
      code: "CSE",
      name: "Computer Science",
      parentId: rootUnit.id,
      level: 1,
      sortOrder: 1,
      path: "UNIV/CSE",
      state: "ACTIVE",
      createdByUserId: actorUserId,
    },
  });

  const eceUnit = await prisma.orgUnit.create({
    data: {
      tenantId,
      versionId: version.id,
      typeId: deptType.id,
      code: "ECE",
      name: "Electronics",
      parentId: rootUnit.id,
      level: 1,
      sortOrder: 2,
      path: "UNIV/ECE",
      state: "ACTIVE",
      createdByUserId: actorUserId,
    },
  });

  return {
    version,
    rootUnit,
    cseUnit,
    eceUnit,
  };
}

async function ensureCategory({
  tenantId,
  scope,
  categoryKey,
  displayLabel,
  description,
  colorHex,
  createdByUserId,
}) {
  if (tenantId === null) {
    const existing = await prisma.kraCategoryDefinition.findFirst({
      where: {
        tenantId: null,
        categoryKey,
      },
    });

    if (existing) {
      return prisma.kraCategoryDefinition.update({
        where: { id: existing.id },
        data: {
          displayLabel,
          description,
          colorHex,
          isActive: true,
        },
      });
    }

    return prisma.kraCategoryDefinition.create({
      data: {
        tenantId: null,
        scope,
        categoryKey,
        displayLabel,
        description,
        colorHex,
        isActive: true,
        createdByUserId,
      },
    });
  }

  return prisma.kraCategoryDefinition.upsert({
    where: {
      tenantId_categoryKey: {
        tenantId,
        categoryKey,
      },
    },
    update: {
      displayLabel,
      description,
      colorHex,
      isActive: true,
    },
    create: {
      tenantId,
      scope,
      categoryKey,
      displayLabel,
      description,
      colorHex,
      isActive: true,
      createdByUserId,
    },
  });
}

async function ensureDemoDataset(
  tenant,
  owner,
  facultyOne,
  facultyTwo,
  demoEmployee,
  cseUnit,
  tenantCategory,
) {
  const parentTargetValue = 15;
  const demoEmployeeTargetValue = 3;

  const period = await prisma.assessmentPeriod.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: "AY2025_26",
      },
    },
    update: {
      name: "AY 2025-26",
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2025-04-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      state: "IN_PROGRESS",
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: new Date("2025-04-30T00:00:00.000Z"),
      achievementDeadline: new Date("2026-03-15T00:00:00.000Z"),
      reviewDeadline: new Date("2026-03-31T00:00:00.000Z"),
      description: "Seeded assessment period for Release 1 verification.",
    },
    create: {
      tenantId: tenant.id,
      name: "AY 2025-26",
      code: "AY2025_26",
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2025-04-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      state: "IN_PROGRESS",
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: new Date("2025-04-30T00:00:00.000Z"),
      achievementDeadline: new Date("2026-03-15T00:00:00.000Z"),
      reviewDeadline: new Date("2026-03-31T00:00:00.000Z"),
      description: "Seeded assessment period for Release 1 verification.",
      createdByUserId: owner.id,
    },
  });

  let kra = await prisma.kraDefinition.findFirst({
    where: {
      tenantId: tenant.id,
      periodId: period.id,
      title: "Seed: Research Excellence",
    },
  });

  if (!kra) {
    kra = await prisma.kraDefinition.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        categoryId: tenantCategory.id,
        title: "Seed: Research Excellence",
        description: "Research-focused KRA seeded for the demo tenant.",
        weightage: 100,
        state: "ACTIVE",
        sortOrder: 1,
        createdByUserId: owner.id,
      },
    });
  } else if (kra.state !== "ACTIVE") {
    kra = await prisma.kraDefinition.update({
      where: { id: kra.id },
      data: {
        categoryId: tenantCategory.id,
        description: "Research-focused KRA seeded for the demo tenant.",
        weightage: 100,
        state: "ACTIVE",
      },
    });
  }

  let kpi = await prisma.kpiDefinition.findFirst({
    where: {
      kraDefinitionId: kra.id,
      title: "Seed: Indexed Publications",
    },
  });

  if (!kpi) {
    kpi = await prisma.kpiDefinition.create({
      data: {
        kraDefinitionId: kra.id,
        title: "Seed: Indexed Publications",
        description: "Number of indexed publications produced in the period.",
        measurementType: "NUMERIC",
        unitLabel: "papers",
        weightage: 100,
        defaultTarget: 12,
        measurementConfig: {
          type: "NUMERIC",
          decimalPlaces: 0,
        },
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: {
          method: "LINEAR",
          capAt100: true,
        },
        allocationType: "BOTH",
        startingUnitId: cseUnit.id,
        state: "ACTIVE",
        sortOrder: 1,
        guidanceNotes: "Seeded KPI for Release 1 demo flows.",
      },
    });
  }

  let parentAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: tenant.id,
      notes: "seed-parent-cse-publications",
    },
  });

  if (!parentAllocation) {
    parentAllocation = await prisma.targetAllocation.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUnitId: cseUnit.id,
        allocatedByUserId: owner.id,
        targetValue: parentTargetValue,
        state: "LOCKED",
        lockedAt: new Date(),
        notes: "seed-parent-cse-publications",
      },
    });
  } else {
    parentAllocation = await prisma.targetAllocation.update({
      where: { id: parentAllocation.id },
      data: {
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUnitId: cseUnit.id,
        allocatedByUserId: owner.id,
        targetValue: parentTargetValue,
        state: "LOCKED",
        lockedAt: parentAllocation.lockedAt ?? new Date(),
        notes: "seed-parent-cse-publications",
      },
    });
  }

  let facultyOneAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: tenant.id,
      notes: "seed-faculty-one-publications",
    },
  });

  if (!facultyOneAllocation) {
    facultyOneAllocation = await prisma.targetAllocation.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: facultyOne.id,
        allocatedByUserId: owner.id,
        targetValue: 6,
        state: "LOCKED",
        lockedAt: new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-faculty-one-publications",
      },
    });
  } else {
    facultyOneAllocation = await prisma.targetAllocation.update({
      where: { id: facultyOneAllocation.id },
      data: {
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: facultyOne.id,
        allocatedByUserId: owner.id,
        targetValue: 6,
        state: "LOCKED",
        lockedAt: facultyOneAllocation.lockedAt ?? new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-faculty-one-publications",
      },
    });
  }

  let facultyTwoAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: tenant.id,
      notes: "seed-faculty-two-publications",
    },
  });

  if (!facultyTwoAllocation) {
    facultyTwoAllocation = await prisma.targetAllocation.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: facultyTwo.id,
        allocatedByUserId: owner.id,
        targetValue: 6,
        state: "LOCKED",
        lockedAt: new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-faculty-two-publications",
      },
    });
  } else {
    facultyTwoAllocation = await prisma.targetAllocation.update({
      where: { id: facultyTwoAllocation.id },
      data: {
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: facultyTwo.id,
        allocatedByUserId: owner.id,
        targetValue: 6,
        state: "LOCKED",
        lockedAt: facultyTwoAllocation.lockedAt ?? new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-faculty-two-publications",
      },
    });
  }

  let demoEmployeeAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: tenant.id,
      notes: "seed-demo-employee-publications",
    },
  });

  if (!demoEmployeeAllocation) {
    demoEmployeeAllocation = await prisma.targetAllocation.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: demoEmployee.id,
        allocatedByUserId: owner.id,
        targetValue: demoEmployeeTargetValue,
        state: "LOCKED",
        lockedAt: new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-demo-employee-publications",
      },
    });
  } else {
    demoEmployeeAllocation = await prisma.targetAllocation.update({
      where: { id: demoEmployeeAllocation.id },
      data: {
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        assignedToUserId: demoEmployee.id,
        allocatedByUserId: owner.id,
        targetValue: demoEmployeeTargetValue,
        state: "LOCKED",
        lockedAt: demoEmployeeAllocation.lockedAt ?? new Date(),
        parentAllocationId: parentAllocation.id,
        notes: "seed-demo-employee-publications",
      },
    });
  }

  const existingAchievement = await prisma.achievement.findFirst({
    where: {
      tenantId: tenant.id,
      targetAllocationId: facultyOneAllocation.id,
      reportedByUserId: facultyOne.id,
      evidenceDescription: "Seed verified achievement",
    },
  });

  if (!existingAchievement) {
    await prisma.achievement.create({
      data: {
        tenantId: tenant.id,
        periodId: period.id,
        kpiDefinitionId: kpi.id,
        targetAllocationId: facultyOneAllocation.id,
        reportedByUserId: facultyOne.id,
        actualValue: 7,
        evidenceDescription: "Seed verified achievement",
        evidenceLinks: [],
        computedScore: 100,
        state: "VERIFIED",
        verifiedByUserId: owner.id,
        verifiedAt: new Date(),
        verificationNote: "Seeded as approved sample data.",
        reportingDate: new Date("2026-01-15T00:00:00.000Z"),
      },
    });
  }

  return {
    period,
    kra,
    kpi,
    allocations: [
      parentAllocation,
      facultyOneAllocation,
      facultyTwoAllocation,
      demoEmployeeAllocation,
    ],
    demoEmployeeAllocation,
  };
}

async function main() {
  const superadminEmail =
    (process.env.SUPERADMIN_EMAIL ?? "superadmin@local.test").trim().toLowerCase();

  const superadmin = await upsertUser({
    email: superadminEmail,
    firstName: process.env.SUPERADMIN_FIRST_NAME ?? "Platform",
    lastName: process.env.SUPERADMIN_LAST_NAME ?? "Admin",
    password: process.env.SUPERADMIN_PASSWORD ?? "Admin@12345",
    isSuperadmin: true,
  });

  const owner = await upsertUser({
    email: "owner@demo-university.local.test",
    firstName: "Demo",
    lastName: "Owner",
    password: DEMO_PASSWORD,
  });
  const admin = await upsertUser({
    email: "admin@demo-university.local.test",
    firstName: "Demo",
    lastName: "Admin",
    password: DEMO_PASSWORD,
  });
  const facultyOne = await upsertUser({
    email: "faculty1@demo-university.local.test",
    firstName: "Anita",
    lastName: "Faculty",
    password: DEMO_PASSWORD,
  });
  const facultyTwo = await upsertUser({
    email: "faculty2@demo-university.local.test",
    firstName: "Bharat",
    lastName: "Faculty",
    password: DEMO_PASSWORD,
  });
  const demoEmployee = await upsertUser({
    email: "employee@demo-university.local.test",
    firstName: "Demo",
    lastName: "Employee",
    password: DEMO_PASSWORD,
  });

  const tenant = await prisma.tenant.upsert({
    where: {
      code: "DEMO_UNIV",
    },
    update: {
      name: "Demo University",
      legalOrganizationName: "Demo University",
      organizationType: "UNIVERSITY",
      primaryDomains: ["demo-university.local.test"],
      subscriptionPlan: "ENTERPRISE",
      lifecycleState: "ACTIVE",
      ownerUserId: owner.id,
      createdByUserId: superadmin.id,
    },
    create: {
      code: "DEMO_UNIV",
      name: "Demo University",
      legalOrganizationName: "Demo University",
      organizationType: "UNIVERSITY",
      primaryDomains: ["demo-university.local.test"],
      subscriptionPlan: "ENTERPRISE",
      lifecycleState: "ACTIVE",
      ownerUserId: owner.id,
      createdByUserId: superadmin.id,
    },
  });

  await prisma.tenantPolicy.upsert({
    where: {
      tenantId: tenant.id,
    },
    update: {},
    create: {
      tenantId: tenant.id,
    },
  });

  await ensureMembership({
    tenantId: tenant.id,
    userId: owner.id,
    role: "TENANT_OWNER",
    createdByUserId: superadmin.id,
    employeeId: "EMP-OWNER-001",
    designation: "Tenant Owner",
  });
  await ensureMembership({
    tenantId: tenant.id,
    userId: admin.id,
    role: "TENANT_ADMIN",
    createdByUserId: owner.id,
    employeeId: "EMP-ADMIN-001",
    designation: "Tenant Admin",
  });
  await ensureMembership({
    tenantId: tenant.id,
    userId: facultyOne.id,
    role: "TENANT_USER",
    createdByUserId: owner.id,
    employeeId: "EMP-FAC-001",
    designation: "Professor",
  });
  await ensureMembership({
    tenantId: tenant.id,
    userId: facultyTwo.id,
    role: "TENANT_USER",
    createdByUserId: owner.id,
    employeeId: "EMP-FAC-002",
    designation: "Associate Professor",
  });

  const { cseUnit } = await ensurePublishedStructure(tenant.id, owner.id);
  if (!cseUnit) {
    throw new Error("Seed structure did not create the CSE unit.");
  }

  await ensureMembership({
    tenantId: tenant.id,
    userId: demoEmployee.id,
    role: "TENANT_USER",
    createdByUserId: owner.id,
    employeeId: "EMP-CSE-003",
    designation: "Assistant Professor",
  });

  await ensurePrimaryUnitAssignment({
    versionId: cseUnit.versionId,
    unitId: cseUnit.id,
    userId: demoEmployee.id,
  });

  await ensureCategory({
    tenantId: null,
    scope: "GLOBAL",
    categoryKey: "RESEARCH",
    displayLabel: "Research",
    description: "Global research-focused category.",
    colorHex: "#2563EB",
    createdByUserId: superadmin.id,
  });

  const tenantCategory = await ensureCategory({
    tenantId: tenant.id,
    scope: "TENANT",
    categoryKey: "ACADEMICS",
    displayLabel: "Academics",
    description: "Tenant-specific academic outcomes.",
    colorHex: "#0F766E",
    createdByUserId: owner.id,
  });

  const demoData = await ensureDemoDataset(
    tenant,
    owner,
    facultyOne,
    facultyTwo,
    demoEmployee,
    cseUnit,
    tenantCategory,
  );

  console.log("Seed completed:", {
    database: DATABASE_URL,
    superadmin: {
      email: superadmin.officialEmail,
      password: process.env.SUPERADMIN_PASSWORD ?? "Admin@12345",
    },
    demoTenant: {
      code: tenant.code,
      ownerEmail: owner.officialEmail,
      adminEmail: admin.officialEmail,
      demoPassword: DEMO_PASSWORD,
    },
    demoEmployee: {
      email: demoEmployee.officialEmail,
      employeeId: "EMP-CSE-003",
      primaryUnitCode: cseUnit.code,
      allocationId: demoData.demoEmployeeAllocation.id,
      allocationTarget: demoData.demoEmployeeAllocation.targetValue,
      demoPassword: DEMO_PASSWORD,
    },
    seededPeriodCode: demoData.period.code,
    seededKra: demoData.kra.title,
    seededKpi: demoData.kpi.title,
    allocationCount: demoData.allocations.length,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
