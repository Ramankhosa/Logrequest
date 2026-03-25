import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserLifecycleState } from "@prisma/client";
import { hash } from "bcryptjs";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = "postgresql://postgres:123@localhost:5432/logrequest";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo@12345";
const R43_SEED_PREFIX = "seed:r43";
// Keep these identifiers stable unless the seeded smoke/regression tests are updated too.
const R43_PUBLICATION_KPI_TITLE = "Seed: Publication Incentive Workflow";
const R43_PUBLICATION_PREFIX = "Seed R4.3";

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

const DEFAULT_BENEFIT_TYPES = [
  { code: "MONETARY", name: "Monetary Incentive", unit: "INR", sortOrder: 0 },
  { code: "LEAVE_POINTS", name: "Leave Points", unit: "Points", sortOrder: 1 },
];

const DEFAULT_CONTRIBUTOR_ROLES = [
  { code: "LEAD_AUTHOR", name: "Lead / First Author", defaultCreditPercent: 60, sortOrder: 0 },
  { code: "CO_AUTHOR", name: "Co-Author", defaultCreditPercent: 20, sortOrder: 1 },
  { code: "CORRESPONDING", name: "Corresponding Author", defaultCreditPercent: 50, sortOrder: 2 },
];

const R43_PUBLICATION_FORM_FIELDS = [
  { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "journalName", label: "Journal / Conference", type: "TEXT", required: true, sortOrder: 1 },
  {
    key: "doi",
    label: "DOI",
    type: "TEXT",
    required: false,
    placeholder: "10.xxxx/...",
    sortOrder: 2,
    marker: "UNIQUE_CHECK",
  },
  {
    key: "indexing",
    label: "Indexing",
    type: "MULTI_SELECT",
    required: true,
    options: ["Scopus", "Web of Science", "UGC CARE List", "PubMed", "IEEE Xplore", "Other"],
    sortOrder: 3,
    marker: "CATEGORY_FIELD",
  },
  {
    key: "journalTier",
    label: "Journal Tier",
    type: "SELECT",
    required: true,
    options: ["Q1", "Q2", "Q3", "Q4", "UGC_CARE"],
    sortOrder: 4,
    marker: "CATEGORY_FIELD",
  },
  { key: "publicationDate", label: "Publication Date", type: "DATE", required: true, sortOrder: 5 },
  { key: "pdfLink", label: "Paper PDF / URL", type: "URL", required: true, sortOrder: 6 },
  {
    key: "ugcCareReference",
    label: "UGC Care Reference",
    type: "TEXT",
    required: false,
    sortOrder: 7,
    visibilityRules: [{ fieldKey: "indexing", operator: "has_any", value: ["UGC CARE List"] }],
    requiredRules: [{ fieldKey: "indexing", operator: "has_any", value: ["UGC CARE List"] }],
    helpText: "Required when the paper is claimed through UGC CARE indexing.",
  },
];

const R43_PUBLICATION_TIERS = [
  {
    code: "Q1",
    name: "Q1 Journal",
    value: "Q1",
    priority: 0,
    leadSelectorTag: "FIRST_AUTHOR",
    monetaryAmount: 35000,
    leavePointsAmount: 10,
  },
  {
    code: "Q2",
    name: "Q2 Journal",
    value: "Q2",
    priority: 1,
    leadSelectorTag: "FIRST_AUTHOR",
    monetaryAmount: 30000,
    leavePointsAmount: 8,
  },
  {
    code: "UGC_CARE",
    name: "UGC Care Journal",
    value: "UGC_CARE",
    priority: 2,
    leadSelectorTag: "CORRESPONDING_AUTHOR",
    monetaryAmount: 5000,
    leavePointsAmount: 5,
  },
];

function userName(user) {
  return `${user.firstName} ${user.lastName}`;
}

function at(value) {
  return new Date(value);
}

function makeSeedEventKey(suffix) {
  return `${R43_SEED_PREFIX}:${suffix}`;
}

function buildUnitSnapshot(unit) {
  return {
    unitId: unit?.id ?? null,
    unitName: unit?.name ?? null,
    unitPath: unit?.path ?? null,
    unitTypeKey: unit?.type?.typeKey ?? null,
  };
}

function roundTo(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

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

async function ensureOrgRoleDefinition({
  tenantId,
  roleKey,
  displayLabel,
  description,
  createdByUserId,
}) {
  return prisma.orgRoleDefinition.upsert({
    where: {
      tenantId_roleKey: {
        tenantId,
        roleKey,
      },
    },
    update: {
      displayLabel,
      description,
      isUnitHead: true,
      approvalAuthority: true,
      maxPerUnit: 1,
      sortOrder: 10,
      isActive: true,
    },
    create: {
      tenantId,
      roleKey,
      displayLabel,
      description,
      isUnitHead: true,
      approvalAuthority: true,
      maxPerUnit: 1,
      sortOrder: 10,
      isActive: true,
      createdByUserId,
    },
  });
}

async function ensureUnitHeadAssignment({
  versionId,
  unitId,
  userId,
  roleDefinitionId,
  roleName,
}) {
  const existing = await prisma.orgRoleAssignment.findFirst({
    where: {
      versionId,
      unitId,
      userId,
      OR: [
        { roleDefinitionId },
        { roleName },
      ],
    },
  });

  if (existing) {
    return prisma.orgRoleAssignment.update({
      where: { id: existing.id },
      data: {
        roleDefinitionId,
        roleName,
        scope: "NODE",
        isActive: true,
        effectiveTo: null,
        effectiveFrom: existing.effectiveFrom ?? new Date(),
      },
    });
  }

  return prisma.orgRoleAssignment.create({
    data: {
      versionId,
      unitId,
      userId,
      roleDefinitionId,
      roleName,
      scope: "NODE",
      isActive: true,
      effectiveFrom: new Date(),
    },
  });
}

async function ensureBenefitTypes(tenantId) {
  const benefitTypes = [];
  for (const row of DEFAULT_BENEFIT_TYPES) {
    const benefitType = await prisma.benefitType.upsert({
      where: {
        tenantId_code: {
          tenantId,
          code: row.code,
        },
      },
      update: {
        name: row.name,
        unit: row.unit,
        precision: 2,
        roundingMode: "HALF_UP",
        sortOrder: row.sortOrder,
        isActive: true,
      },
      create: {
        tenantId,
        code: row.code,
        name: row.name,
        unit: row.unit,
        precision: 2,
        roundingMode: "HALF_UP",
        sortOrder: row.sortOrder,
        isActive: true,
      },
    });
    benefitTypes.push(benefitType);
  }
  return new Map(benefitTypes.map((row) => [row.code, row]));
}

async function ensureContributorRoles(tenantId) {
  const roles = [];
  for (const row of DEFAULT_CONTRIBUTOR_ROLES) {
    const role = await prisma.contributorRole.upsert({
      where: {
        tenantId_code: {
          tenantId,
          code: row.code,
        },
      },
      update: {
        name: row.name,
        defaultCreditPercent: row.defaultCreditPercent,
        sortOrder: row.sortOrder,
        isActive: true,
      },
      create: {
        tenantId,
        code: row.code,
        name: row.name,
        defaultCreditPercent: row.defaultCreditPercent,
        sortOrder: row.sortOrder,
        isActive: true,
      },
    });
    roles.push(role);
  }
  return new Map(roles.map((row) => [row.code, row]));
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

async function ensureReviewerUsers({
  tenant,
  owner,
  cseUnit,
  eceUnit,
}) {
  const cseHead = await upsertUser({
    email: "cse.head@demo-university.local.test",
    firstName: "CSE",
    lastName: "Head",
    password: DEMO_PASSWORD,
  });
  const eceHead = await upsertUser({
    email: "ece.head@demo-university.local.test",
    firstName: "ECE",
    lastName: "Head",
    password: DEMO_PASSWORD,
  });

  for (const [user, employeeId, unit] of [
    [cseHead, "EMP-CSE-HEAD-001", cseUnit],
    [eceHead, "EMP-ECE-HEAD-001", eceUnit],
  ]) {
    await ensureMembership({
      tenantId: tenant.id,
      userId: user.id,
      role: "TENANT_USER",
      createdByUserId: owner.id,
      employeeId,
      designation: "Department Head",
    });
    await ensurePrimaryUnitAssignment({
      versionId: unit.versionId,
      unitId: unit.id,
      userId: user.id,
    });
  }

  const roleDefinition = await ensureOrgRoleDefinition({
    tenantId: tenant.id,
    roleKey: "DEPARTMENT_HEAD",
    displayLabel: "Department Head",
    description: "Seeded review head for KPI workflow demo data.",
    createdByUserId: owner.id,
  });

  await ensureUnitHeadAssignment({
    versionId: cseUnit.versionId,
    unitId: cseUnit.id,
    userId: cseHead.id,
    roleDefinitionId: roleDefinition.id,
    roleName: roleDefinition.displayLabel,
  });
  await ensureUnitHeadAssignment({
    versionId: eceUnit.versionId,
    unitId: eceUnit.id,
    userId: eceHead.id,
    roleDefinitionId: roleDefinition.id,
    roleName: roleDefinition.displayLabel,
  });

  return { cseHead, eceHead };
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

async function ensureR43RewardKpi({
  tenant,
  owner,
  kra,
  cseUnit,
  eceUnit,
}) {
  let kpi = await prisma.kpiDefinition.findFirst({
    where: {
      kraDefinitionId: kra.id,
      title: R43_PUBLICATION_KPI_TITLE,
    },
  });

  const baseKpiData = {
    kraDefinitionId: kra.id,
    title: R43_PUBLICATION_KPI_TITLE,
    description:
      "Seeded publication incentive KPI with workflow remarks, notifications, and reward operations demo data.",
    measurementType: "NUMERIC",
    unitLabel: "papers",
    weightage: 0,
    defaultTarget: 4,
    measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
    scoringMethod: "LINEAR",
    scoringDirection: "ASCENDING",
    scoringConfig: { method: "LINEAR", capAt100: true },
    allocationType: "BOTH",
    startingUnitId: cseUnit.id,
    achievementTemplateKey: "PUBLICATION",
    achievementFormConfig: {
      templateKey: "PUBLICATION",
      fields: R43_PUBLICATION_FORM_FIELDS,
    },
    keyUnitId: eceUnit.id,
    finalUnitId: cseUnit.id,
    evidenceRequired: true,
    evidenceTypes: ["DOCUMENT", "URL"],
    evidenceInstructions:
      "Seeded R4.3 workflow demo: attach DOI proof and use contributor selector tags where applicable.",
    isTeamKpi: true,
    teamCreditMethod: "WEIGHTED_SPLIT",
    allowPartialCompletion: true,
    participantMode: "OPTIONAL_TEAM",
    rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
    policyDateFieldKey: "publicationDate",
    state: "ACTIVE",
    sortOrder: 2,
    guidanceNotes:
      "Use FIRST_AUTHOR and CORRESPONDING_AUTHOR selector tags to test reward distribution in the target-user form.",
  };

  if (!kpi) {
    kpi = await prisma.kpiDefinition.create({ data: baseKpiData });
  } else {
    kpi = await prisma.kpiDefinition.update({
      where: { id: kpi.id },
      data: baseKpiData,
    });
  }

  return kpi;
}

async function ensureR43KpiConfig({
  kpi,
  roleMap,
  benefitTypeMap,
}) {
  await prisma.kpiContributorConfig.upsert({
    where: { kpiDefinitionId: kpi.id },
    update: {
      allowExternalContributors: true,
      duplicateCheckFields: ["doi"],
      creditSumMode: "MUST_EQUAL_100",
    },
    create: {
      kpiDefinitionId: kpi.id,
      allowExternalContributors: true,
      duplicateCheckFields: ["doi"],
      creditSumMode: "MUST_EQUAL_100",
    },
  });

  await prisma.kpiApplicableRole.deleteMany({
    where: { kpiDefinitionId: kpi.id },
  });
  await prisma.kpiApplicableRole.createMany({
    data: [
      {
        kpiDefinitionId: kpi.id,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        isDefault: true,
        sortOrder: 0,
      },
      {
        kpiDefinitionId: kpi.id,
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        isDefault: false,
        sortOrder: 1,
      },
      {
        kpiDefinitionId: kpi.id,
        contributorRoleId: roleMap.get("CORRESPONDING").id,
        isDefault: false,
        sortOrder: 2,
      },
    ],
  });

  const existingComponents = await prisma.kpiRewardComponent.findMany({
    where: { kpiDefinitionId: kpi.id },
    select: { id: true },
  });
  if (existingComponents.length > 0) {
    await prisma.kpiRewardDistribution.deleteMany({
      where: { rewardComponentId: { in: existingComponents.map((row) => row.id) } },
    });
  }
  await prisma.kpiRewardRule.deleteMany({
    where: { rewardTier: { kpiDefinitionId: kpi.id } },
  });
  await prisma.kpiRewardComponent.deleteMany({
    where: { kpiDefinitionId: kpi.id },
  });
  await prisma.kpiRewardTier.deleteMany({
    where: { kpiDefinitionId: kpi.id },
  });

  for (const tier of R43_PUBLICATION_TIERS) {
    const createdTier = await prisma.kpiRewardTier.create({
      data: {
        kpiDefinitionId: kpi.id,
        tierSetKey: "PRIMARY",
        code: tier.code,
        name: tier.name,
        description: `Seeded tier for ${tier.value} publications.`,
        priority: tier.priority,
        matchMode: "HIGHEST_MATCH",
        isActive: true,
      },
    });

    await prisma.kpiRewardRule.create({
      data: {
        rewardTierId: createdTier.id,
        source: "FORM_FIELD",
        operator: "eq",
        fieldKey: "journalTier",
        value: tier.value,
        sortOrder: 0,
      },
    });

    for (const componentDef of [
      {
        code: `${tier.code}_MONETARY`,
        name: `${tier.name} Monetary Incentive`,
        amountValue: tier.monetaryAmount,
        benefitTypeCode: "MONETARY",
      },
      {
        code: `${tier.code}_LEAVE_POINTS`,
        name: `${tier.name} Leave Points`,
        amountValue: tier.leavePointsAmount,
        benefitTypeCode: "LEAVE_POINTS",
      },
    ]) {
      const component = await prisma.kpiRewardComponent.create({
        data: {
          kpiDefinitionId: kpi.id,
          rewardTierId: createdTier.id,
          benefitTypeId: benefitTypeMap.get(componentDef.benefitTypeCode).id,
          code: componentDef.code,
          name: componentDef.name,
          description: `Seeded ${componentDef.benefitTypeCode.toLowerCase()} component for ${tier.name}.`,
          trigger: "FINAL_VERIFY",
          amountMode: "FIXED_POOL",
          amountValue: componentDef.amountValue,
          distributionMode: "ROLE_PERCENT_SPLIT",
          singleEligibleHandling: "FULL_TO_SINGLE",
          emptyShareHandling: "ROLLOVER_TO_MATCHED",
          isActive: true,
          sortOrder: componentDef.benefitTypeCode === "MONETARY" ? tier.priority * 2 : tier.priority * 2 + 1,
        },
      });

      await prisma.kpiRewardDistribution.createMany({
        data: [
          {
            rewardComponentId: component.id,
            selectorType: "SELECTOR_TAG",
            selectorTag: tier.leadSelectorTag,
            sharePercent: 70,
            splitMode: "FULL_TO_MATCHED",
            sortOrder: 0,
          },
          {
            rewardComponentId: component.id,
            selectorType: "REMAINDER",
            selectorTag: null,
            sharePercent: 30,
            splitMode: "EQUAL",
            sortOrder: 1,
          },
        ],
      });
    }
  }

  return prisma.kpiDefinition.findUniqueOrThrow({
    where: { id: kpi.id },
    include: {
      rewardTiers: { orderBy: [{ priority: "asc" }, { code: "asc" }] },
      rewardComponents: {
        include: {
          benefitType: true,
          rewardTier: true,
          distributions: { orderBy: { sortOrder: "asc" } },
        },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      },
    },
  });
}

async function ensureSeedAllocation({
  tenantId,
  periodId,
  kpiDefinitionId,
  assignedToUnitId,
  assignedToUserId,
  allocatedByUserId,
  targetValue,
  parentAllocationId,
  notes,
}) {
  const existing = await prisma.targetAllocation.findFirst({
    where: { tenantId, notes },
  });

  if (existing) {
    return prisma.targetAllocation.update({
      where: { id: existing.id },
      data: {
        periodId,
        kpiDefinitionId,
        assignedToUnitId: assignedToUnitId ?? null,
        assignedToUserId: assignedToUserId ?? null,
        allocatedByUserId,
        targetValue,
        parentAllocationId: parentAllocationId ?? null,
        state: "LOCKED",
        lockedAt: existing.lockedAt ?? new Date(),
        notes,
      },
    });
  }

  return prisma.targetAllocation.create({
    data: {
      tenantId,
      periodId,
      kpiDefinitionId,
      assignedToUnitId: assignedToUnitId ?? null,
      assignedToUserId: assignedToUserId ?? null,
      allocatedByUserId,
      targetValue,
      parentAllocationId: parentAllocationId ?? null,
      state: "LOCKED",
      lockedAt: new Date(),
      notes,
    },
  });
}

function buildVerificationLogEntry(level, user, action, note, when) {
  return {
    level,
    userId: user.id,
    userName: userName(user),
    action,
    ...(note ? { note } : {}),
    at: when.toISOString(),
  };
}

function buildRewardAllocations({
  contributors,
  leadSelectorTag,
  amount,
  precision,
}) {
  const eligible = contributors.filter((row) => !row.isExcludedFromReward);
  if (eligible.length === 0) return [];

  const totalAmount = roundTo(amount, precision);
  if (eligible.length === 1) {
    return [
      {
        contributor: eligible[0],
        amount: totalAmount,
        fallbackApplied: "FULL_TO_SINGLE",
        roundingAdjustment: roundTo(totalAmount - amount, precision),
      },
    ];
  }

  const lead = eligible.find((row) => row.selectorTags.includes(leadSelectorTag)) ?? eligible[0];
  const remainder = eligible.filter((row) => row.id !== lead.id);
  if (remainder.length === 0) {
    return [
      {
        contributor: lead,
        amount: totalAmount,
        fallbackApplied: "ROLLOVER_TO_MATCHED",
        roundingAdjustment: roundTo(totalAmount - amount, precision),
      },
    ];
  }

  const leadAmount = roundTo(amount * 0.7, precision);
  const remainderPool = totalAmount - leadAmount;
  const perRemainder = roundTo(remainderPool / remainder.length, precision);
  const allocations = [
    {
      contributor: lead,
      amount: leadAmount,
      fallbackApplied: null,
      roundingAdjustment: 0,
    },
    ...remainder.map((row) => ({
      contributor: row,
      amount: perRemainder,
      fallbackApplied: null,
      roundingAdjustment: 0,
    })),
  ];

  const roundedTotal = roundTo(
    allocations.reduce((sum, row) => sum + row.amount, 0),
    precision,
  );
  const residual = roundTo(totalAmount - roundedTotal, precision);
  if (residual !== 0) {
    allocations[0].amount = roundTo(allocations[0].amount + residual, precision);
    allocations[0].roundingAdjustment = residual;
  }

  return allocations;
}

async function recreateSubmissionTrail(achievementId, trailEntries) {
  await prisma.submissionTrail.deleteMany({
    where: { achievementId },
  });
  for (const entry of trailEntries) {
    await prisma.submissionTrail.create({
      data: {
        achievementId,
        action: entry.action,
        actorUserId: entry.actor.id,
        actorName: userName(entry.actor),
        actorRole: entry.actorRole,
        actorUnitName: entry.actorUnitName ?? null,
        note: entry.note ?? null,
        scoreAtAction: entry.scoreAtAction ?? null,
        metadata: entry.metadata ?? undefined,
        createdAt: entry.createdAt,
      },
    });
  }
}

async function createSeedAchievement({
  tenant,
  period,
  kpi,
  allocationId,
  reporter,
  state,
  title,
  reportingDate,
  actualValue,
  actualDate,
  evidenceDescription,
  evidenceLinks,
  achievementFormData,
  currentVerifierUnitId = null,
  currentVerifierUserId = null,
  recommendedByUserId = null,
  recommendedAt = null,
  recommendationNote = null,
  verifiedByUserId = null,
  verifiedAt = null,
  verificationNote = null,
  rejectionReason = null,
  verificationLog = [],
  computedScore = 25,
  effectiveScore = 25,
  contributors,
  trailEntries,
}) {
  const achievement = await prisma.achievement.create({
    data: {
      tenantId: tenant.id,
      periodId: period.id,
      kpiDefinitionId: kpi.id,
      targetAllocationId: allocationId,
      reportedByUserId: reporter.id,
      title,
      actualValue,
      actualDate,
      evidenceDescription,
      evidenceLinks,
      achievementFormData,
      state,
      currentVerifierUnitId,
      currentVerifierUserId,
      isTeamAchievement: contributors.length > 1,
      computedScore,
      effectiveScore,
      recommendedByUserId,
      recommendedAt,
      recommendationNote,
      verifiedByUserId,
      verifiedAt,
      verificationNote,
      rejectionReason,
      verificationLog,
      reportingDate,
    },
  });

  await prisma.achievementContributor.createMany({
    data: contributors.map((row) => ({
      achievementId: achievement.id,
      type: row.type ?? "INTERNAL",
      userId: row.user?.id ?? null,
      externalName: row.externalName ?? null,
      externalAffiliation: row.externalAffiliation ?? null,
      contributorRoleId: row.contributorRoleId,
      creditPercent: row.creditPercent,
      isExcludedFromReward: row.isExcludedFromReward ?? false,
      selectorTags: row.selectorTags ?? [],
      note: row.note ?? null,
      externalData: row.externalData ?? undefined,
    })),
  });

  await recreateSubmissionTrail(achievement.id, trailEntries);

  const contributorRows = await prisma.achievementContributor.findMany({
    where: { achievementId: achievement.id },
    orderBy: { createdAt: "asc" },
  });

  return { achievement, contributors: contributorRows };
}

async function createSeedNotifications(rows) {
  for (const row of rows) {
    await prisma.notification.create({
      data: {
        tenantId: row.tenantId,
        userId: row.userId,
        type: row.type,
        eventKey: row.eventKey,
        title: row.title,
        message: row.message,
        entityType: row.entityType ?? null,
        entityId: row.entityId ?? null,
        linkUrl: row.linkUrl ?? null,
        isRead: row.isRead ?? false,
        createdAt: row.createdAt,
      },
    });
  }
}

async function linkReplacementRewards({
  revokedRows,
  replacementRows,
}) {
  for (const [key, revokedReward] of revokedRows.entries()) {
    const replacement = replacementRows.get(key);
    if (!replacement) continue;
    await prisma.contributorReward.update({
      where: { id: revokedReward.id },
      data: { replacedByRewardId: replacement.id },
    });
    await prisma.contributorReward.update({
      where: { id: replacement.id },
      data: { supersedesRewardId: revokedReward.id },
    });
  }
}

async function createRewardRowsForAchievement({
  tenant,
  period,
  kpi,
  achievement,
  contributors,
  componentMap,
  tierMap,
  unitSnapshotByUserId,
  reporterUnit,
  owner,
  scenarioKey,
  tierCode,
  stateByComponentCode,
  stateNoteByComponentCode = {},
  releaseReferenceByComponentCode = {},
  revokedReasonByComponentCode = {},
  supersedesByComponentCode = {},
  replacementMode = false,
}) {
  const createdRows = new Map();
  const tier = tierMap.get(tierCode);
  const tierLeadSelector =
    R43_PUBLICATION_TIERS.find((row) => row.code === tierCode)?.leadSelectorTag ?? "FIRST_AUTHOR";
  const eligibleContributors = contributors.map((row) => ({
    id: row.id,
    userId: row.userId,
    contributorRoleId: row.contributorRoleId,
    creditPercent: row.creditPercent,
    isExcludedFromReward: row.isExcludedFromReward,
    selectorTags: row.selectorTags,
  }));

  for (const component of componentMap.values()) {
    if (component.rewardTierId !== tier?.id) continue;

    const allocations = buildRewardAllocations({
      contributors: eligibleContributors,
      leadSelectorTag: tierLeadSelector,
      amount: component.amountValue ?? 0,
      precision: component.benefitType.precision ?? 2,
    });

    for (const allocation of allocations) {
      const ownerSnapshot =
        (allocation.contributor.userId && unitSnapshotByUserId.get(allocation.contributor.userId))
        || reporterUnit;
      const componentState = stateByComponentCode[component.code] ?? "DRAFT";
      const reward = await prisma.contributorReward.create({
        data: {
          tenantId: tenant.id,
          periodId: period.id,
          kpiDefinitionId: kpi.id,
          achievementId: achievement.id,
          achievementContributorId: allocation.contributor.id,
          contributorUserId: allocation.contributor.userId,
          benefitTypeId: component.benefitTypeId,
          rewardTierId: tier.id,
          rewardComponentId: component.id,
          recurrenceKey: String(achievement.achievementFormData?.doi ?? achievement.id),
          state: componentState,
          statusRemark: stateNoteByComponentCode[component.code] ?? null,
          releasedAt:
            componentState === "RELEASED" || componentState === "REVOKED"
              ? at("2026-03-05T10:00:00.000Z")
              : null,
          releasedById:
            componentState === "RELEASED" || componentState === "REVOKED"
              ? owner.id
              : null,
          releaseReference:
            componentState === "RELEASED" || componentState === "REVOKED"
              ? releaseReferenceByComponentCode[component.code] ?? `${scenarioKey.toUpperCase()}-REL`
              : null,
          revokedAt: componentState === "REVOKED" ? at("2026-03-15T11:30:00.000Z") : null,
          revokedById: componentState === "REVOKED" ? owner.id : null,
          revocationReason:
            componentState === "REVOKED"
              ? revokedReasonByComponentCode[component.code] ?? "Seeded revocation after correction."
              : null,
          rewardOwnerUnitId: ownerSnapshot.unitId,
          rewardOwnerUnitName: ownerSnapshot.unitName,
          rewardOwnerUnitPath: ownerSnapshot.unitPath,
          rewardOwnerUnitTypeKey: ownerSnapshot.unitTypeKey,
          reporterUnitId: reporterUnit.unitId,
          reporterUnitName: reporterUnit.unitName,
          reporterUnitPath: reporterUnit.unitPath,
          reporterUnitTypeKey: reporterUnit.unitTypeKey,
          baseAmount: allocation.amount,
          finalAmount: allocation.amount,
          roundingAdjustment: allocation.roundingAdjustment,
          explanation: {
            tierCode,
            componentCode: component.code,
            selectorTags: allocation.contributor.selectorTags,
            fallbackApplied: allocation.fallbackApplied,
            replacementMode,
          },
          idempotencyKey: `${R43_SEED_PREFIX}:${scenarioKey}:${component.code}:${allocation.contributor.userId ?? allocation.contributor.id}:${replacementMode ? "replacement" : "base"}`,
          ...(supersedesByComponentCode[component.code]
            ? {
                supersedesRewardId:
                  supersedesByComponentCode[component.code].get(
                    allocation.contributor.userId ?? allocation.contributor.id,
                  ) ?? null,
              }
            : {}),
        },
      });

      createdRows.set(
        `${component.code}:${allocation.contributor.userId ?? allocation.contributor.id}`,
        reward,
      );

      const events =
        componentState === "PENDING"
          ? [
              {
                action: "GENERATED",
                fromState: null,
                toState: "DRAFT",
                note: "Seeded reward generated.",
                createdAt: at("2026-03-02T08:00:00.000Z"),
              },
              {
                action: "STATUS_UPDATED",
                fromState: "DRAFT",
                toState: "PENDING",
                note: stateNoteByComponentCode[component.code] ?? "Queued for release.",
                createdAt: at("2026-03-04T09:15:00.000Z"),
              },
            ]
          : componentState === "RELEASED"
            ? [
                {
                  action: "GENERATED",
                  fromState: null,
                  toState: "DRAFT",
                  note: "Seeded reward generated.",
                  createdAt: at("2026-03-01T09:30:00.000Z"),
                },
                {
                  action: "STATUS_UPDATED",
                  fromState: "DRAFT",
                  toState: "PENDING",
                  note: "Moved to payment run.",
                  createdAt: at("2026-03-03T11:00:00.000Z"),
                },
                {
                  action: "RELEASED",
                  fromState: "PENDING",
                  toState: "RELEASED",
                  note: stateNoteByComponentCode[component.code] ?? "Released in seeded batch.",
                  createdAt: at("2026-03-05T10:00:00.000Z"),
                },
              ]
            : componentState === "REVOKED"
              ? [
                  {
                    action: "GENERATED",
                    fromState: null,
                    toState: "DRAFT",
                    note: "Seeded reward generated.",
                    createdAt: at("2026-03-01T09:30:00.000Z"),
                  },
                  {
                    action: "STATUS_UPDATED",
                    fromState: "DRAFT",
                    toState: "PENDING",
                    note: "Moved to payment run.",
                    createdAt: at("2026-03-03T11:00:00.000Z"),
                  },
                  {
                    action: "RELEASED",
                    fromState: "PENDING",
                    toState: "RELEASED",
                    note: "Released before correction.",
                    createdAt: at("2026-03-05T10:00:00.000Z"),
                  },
                  {
                    action: "REVOKED",
                    fromState: "RELEASED",
                    toState: "REVOKED",
                    note:
                      revokedReasonByComponentCode[component.code]
                      ?? "Revoked after seeded correction.",
                    createdAt: at("2026-03-15T11:30:00.000Z"),
                  },
                ]
              : [
                  {
                    action: "GENERATED",
                    fromState: null,
                    toState: "DRAFT",
                    note: "Seeded reward generated.",
                    createdAt: at("2026-03-01T09:00:00.000Z"),
                  },
                ];

      for (const event of events) {
        await prisma.contributorRewardEvent.create({
          data: {
            rewardId: reward.id,
            tenantId: tenant.id,
            actorUserId: owner.id,
            actorRole: "TENANT_OWNER",
            action: event.action,
            fromState: event.fromState,
            toState: event.toState,
            note: event.note,
            metadata: {
              seededScenario: scenarioKey,
              componentCode: component.code,
            },
            createdAt: event.createdAt,
          },
        });
      }
    }
  }

  return createdRows;
}

async function ensureR43InterfaceSeed({
  tenant,
  owner,
  facultyOne,
  facultyTwo,
  demoEmployee,
  cseUnit,
  eceUnit,
  period,
  kra,
  reviewerUsers,
}) {
  const benefitTypeMap = await ensureBenefitTypes(tenant.id);
  const roleMap = await ensureContributorRoles(tenant.id);
  const kpiBase = await ensureR43RewardKpi({
    tenant,
    owner,
    kra,
    cseUnit,
    eceUnit,
  });

  await prisma.notification.deleteMany({
    where: {
      tenantId: tenant.id,
      eventKey: { startsWith: `${R43_SEED_PREFIX}:` },
    },
  });
  await prisma.achievement.deleteMany({
    where: {
      tenantId: tenant.id,
      kpiDefinitionId: kpiBase.id,
      title: { startsWith: R43_PUBLICATION_PREFIX },
    },
  });

  const kpi = await ensureR43KpiConfig({
    kpi: kpiBase,
    roleMap,
    benefitTypeMap,
  });

  const parentAllocation = await ensureSeedAllocation({
    tenantId: tenant.id,
    periodId: period.id,
    kpiDefinitionId: kpi.id,
    assignedToUnitId: cseUnit.id,
    assignedToUserId: null,
    allocatedByUserId: owner.id,
    targetValue: 8,
    parentAllocationId: null,
    notes: "seed-r43-parent-publication-workflow",
  });
  const facultyAllocation = await ensureSeedAllocation({
    tenantId: tenant.id,
    periodId: period.id,
    kpiDefinitionId: kpi.id,
    assignedToUnitId: null,
    assignedToUserId: facultyOne.id,
    allocatedByUserId: owner.id,
    targetValue: 4,
    parentAllocationId: parentAllocation.id,
    notes: "seed-r43-faculty1-publication-workflow",
  });
  const employeeAllocation = await ensureSeedAllocation({
    tenantId: tenant.id,
    periodId: period.id,
    kpiDefinitionId: kpi.id,
    assignedToUnitId: null,
    assignedToUserId: demoEmployee.id,
    allocatedByUserId: owner.id,
    targetValue: 4,
    parentAllocationId: parentAllocation.id,
    notes: "seed-r43-employee-publication-workflow",
  });

  const unitRows = await prisma.orgUnit.findMany({
    where: { versionId: cseUnit.versionId, id: { in: [cseUnit.id, eceUnit.id] } },
    include: { type: true },
  });
  const unitById = new Map(unitRows.map((row) => [row.id, row]));
  const cseSnapshot = buildUnitSnapshot(unitById.get(cseUnit.id));
  const eceSnapshot = buildUnitSnapshot(unitById.get(eceUnit.id));
  const unitSnapshotByUserId = new Map([
    [facultyOne.id, cseSnapshot],
    [demoEmployee.id, cseSnapshot],
    [reviewerUsers.cseHead.id, cseSnapshot],
    [facultyTwo.id, eceSnapshot],
    [reviewerUsers.eceHead.id, eceSnapshot],
  ]);
  const tierMap = new Map(kpi.rewardTiers.map((row) => [row.code, row]));
  const componentMap = new Map(kpi.rewardComponents.map((row) => [row.code, row]));

  const pendingRecommendation = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: facultyAllocation.id,
    reporter: facultyOne,
    state: "SUBMITTED",
    title: "Seed R4.3 Pending Recommendation",
    reportingDate: at("2026-02-12T09:00:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-02-10T00:00:00.000Z"),
    evidenceDescription: "Resubmitted publication waiting for school-level recommendation.",
    evidenceLinks: ["https://example.com/r43/pending-recommendation.pdf"],
    achievementFormData: {
      paperTitle: "Adaptive Testing of AI-Assisted Workflow Engines",
      journalName: "Journal of Workflow Research",
      doi: "10.1000/seed-r43-pending-recommendation",
      indexing: ["Scopus"],
      journalTier: "Q1",
      publicationDate: "2026-02-10",
      pdfLink: "https://example.com/r43/pending-recommendation.pdf",
    },
    currentVerifierUnitId: eceUnit.id,
    currentVerifierUserId: reviewerUsers.eceHead.id,
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Initial submission for review.", at("2026-02-05T10:00:00.000Z")),
      buildVerificationLogEntry("REJECT", reviewerUsers.eceHead, "rejected", "Upload the revised indexing proof.", at("2026-02-07T15:30:00.000Z")),
      buildVerificationLogEntry("RESUBMIT", facultyOne, "resubmitted", "Re-uploaded the indexing certificate and DOI proof.", at("2026-02-11T09:10:00.000Z")),
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Resubmitted with the corrected attachment.", at("2026-02-12T09:00:00.000Z")),
    ],
    contributors: [
      {
        user: facultyOne,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 70,
        selectorTags: ["FIRST_AUTHOR"],
      },
      {
        user: facultyTwo,
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        creditPercent: 30,
        selectorTags: [],
      },
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Initial submission for review.", scoreAtAction: 25, createdAt: at("2026-02-05T10:00:00.000Z") },
      { action: "REJECTED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Upload the revised indexing proof.", scoreAtAction: 25, createdAt: at("2026-02-07T15:30:00.000Z") },
      { action: "RESUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Re-uploaded the indexing certificate and DOI proof.", scoreAtAction: 25, createdAt: at("2026-02-11T09:10:00.000Z") },
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Resubmitted with the corrected attachment.", scoreAtAction: 25, createdAt: at("2026-02-12T09:00:00.000Z") },
    ],
  });

  const pendingVerification = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: employeeAllocation.id,
    reporter: demoEmployee,
    state: "RECOMMENDED",
    title: "Seed R4.3 Pending Verification",
    reportingDate: at("2026-02-14T11:15:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-02-13T00:00:00.000Z"),
    evidenceDescription: "Recommended publication waiting for final verification by the source division.",
    evidenceLinks: ["https://example.com/r43/pending-verification.pdf"],
    achievementFormData: {
      paperTitle: "Benchmarking Review Timelines in Academic Institutions",
      journalName: "International Review Systems Journal",
      doi: "10.1000/seed-r43-pending-verification",
      indexing: ["Scopus"],
      journalTier: "Q2",
      publicationDate: "2026-02-13",
      pdfLink: "https://example.com/r43/pending-verification.pdf",
    },
    currentVerifierUnitId: cseUnit.id,
    currentVerifierUserId: reviewerUsers.cseHead.id,
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-02-14T10:30:00.000Z"),
    recommendationNote: "Metadata cross-check completed. Ready for final verification.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", demoEmployee, "submitted", "Submitted with all supporting evidence.", at("2026-02-13T16:20:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Metadata cross-check completed. Ready for final verification.", at("2026-02-14T10:30:00.000Z")),
    ],
    contributors: [
      {
        user: demoEmployee,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 60,
        selectorTags: ["FIRST_AUTHOR"],
      },
      {
        user: facultyTwo,
        contributorRoleId: roleMap.get("CORRESPONDING").id,
        creditPercent: 40,
        selectorTags: ["CORRESPONDING_AUTHOR"],
      },
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: demoEmployee, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Submitted with all supporting evidence.", scoreAtAction: 25, createdAt: at("2026-02-13T16:20:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Metadata cross-check completed. Ready for final verification.", scoreAtAction: 25, createdAt: at("2026-02-14T10:30:00.000Z") },
    ],
  });

  const rejectedPublication = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: facultyAllocation.id,
    reporter: facultyOne,
    state: "REJECTED",
    title: "Seed R4.3 Rejected Publication",
    reportingDate: at("2026-01-28T14:00:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-01-27T00:00:00.000Z"),
    evidenceDescription: "Rejected sample to exercise remarks and target-user history.",
    evidenceLinks: ["https://example.com/r43/rejected-publication.pdf"],
    achievementFormData: {
      paperTitle: "Incomplete Evidence Sample",
      journalName: "Audit Edge Cases Quarterly",
      doi: "10.1000/seed-r43-rejected-publication",
      indexing: ["Scopus"],
      journalTier: "Q2",
      publicationDate: "2026-01-27",
      pdfLink: "https://example.com/r43/rejected-publication.pdf",
    },
    rejectionReason: "Please upload the publisher confirmation letter and corrected DOI.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Submitting the paper for Q2 incentive.", at("2026-01-27T10:00:00.000Z")),
      buildVerificationLogEntry("REJECT", reviewerUsers.eceHead, "rejected", "Please upload the publisher confirmation letter and corrected DOI.", at("2026-01-28T14:00:00.000Z")),
    ],
    contributors: [
      {
        user: facultyOne,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 100,
        selectorTags: ["FIRST_AUTHOR"],
      },
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Submitting the paper for Q2 incentive.", scoreAtAction: 25, createdAt: at("2026-01-27T10:00:00.000Z") },
      { action: "REJECTED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Please upload the publisher confirmation letter and corrected DOI.", scoreAtAction: 25, createdAt: at("2026-01-28T14:00:00.000Z") },
    ],
  });
  const draftRewardsPublication = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: employeeAllocation.id,
    reporter: demoEmployee,
    state: "VERIFIED",
    title: "Seed R4.3 Draft Rewards Publication",
    reportingDate: at("2026-03-01T09:30:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-02-25T00:00:00.000Z"),
    evidenceDescription: "Verified publication with draft rewards for reward-ops testing.",
    evidenceLinks: ["https://example.com/r43/draft-rewards-publication.pdf"],
    achievementFormData: {
      paperTitle: "Draft Reward State Validation Paper",
      journalName: "Systems Verification Journal",
      doi: "10.1000/seed-r43-draft-rewards",
      indexing: ["Scopus"],
      journalTier: "Q1",
      publicationDate: "2026-02-25",
      pdfLink: "https://example.com/r43/draft-rewards-publication.pdf",
    },
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-02-27T11:20:00.000Z"),
    recommendationNote: "Recommended after indexing and DOI validation.",
    verifiedByUserId: reviewerUsers.cseHead.id,
    verifiedAt: at("2026-03-01T09:30:00.000Z"),
    verificationNote: "Verified and waiting for reward release preparation.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", demoEmployee, "submitted", "Paper submitted for seed reward draft case.", at("2026-02-26T09:00:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Recommended after indexing and DOI validation.", at("2026-02-27T11:20:00.000Z")),
      buildVerificationLogEntry("VERIFY", reviewerUsers.cseHead, "verified", "Verified and waiting for reward release preparation.", at("2026-03-01T09:30:00.000Z")),
    ],
    contributors: [
      {
        user: demoEmployee,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 70,
        selectorTags: ["FIRST_AUTHOR"],
      },
      {
        user: facultyTwo,
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        creditPercent: 30,
        selectorTags: [],
      },
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: demoEmployee, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Paper submitted for seed reward draft case.", scoreAtAction: 25, createdAt: at("2026-02-26T09:00:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Recommended after indexing and DOI validation.", scoreAtAction: 25, createdAt: at("2026-02-27T11:20:00.000Z") },
      { action: "VERIFIED", actor: reviewerUsers.cseHead, actorRole: "Department Head", actorUnitName: cseUnit.name, note: "Verified and waiting for reward release preparation.", scoreAtAction: 25, createdAt: at("2026-03-01T09:30:00.000Z") },
    ],
  });

  const pendingRewardsPublication = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: facultyAllocation.id,
    reporter: facultyOne,
    state: "VERIFIED",
    title: "Seed R4.3 Pending Release Publication",
    reportingDate: at("2026-03-02T10:15:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-02-28T00:00:00.000Z"),
    evidenceDescription: "Verified publication whose rewards are queued for release.",
    evidenceLinks: ["https://example.com/r43/pending-release-publication.pdf"],
    achievementFormData: {
      paperTitle: "Queued Reward Batch Example",
      journalName: "Queue Management Review",
      doi: "10.1000/seed-r43-pending-release",
      indexing: ["Scopus"],
      journalTier: "Q2",
      publicationDate: "2026-02-28",
      pdfLink: "https://example.com/r43/pending-release-publication.pdf",
    },
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-03-01T12:10:00.000Z"),
    recommendationNote: "Recommended for Q2 incentive processing.",
    verifiedByUserId: reviewerUsers.cseHead.id,
    verifiedAt: at("2026-03-02T10:15:00.000Z"),
    verificationNote: "Verified and moved to the pending release batch.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Submitted for pending reward batch scenario.", at("2026-02-28T09:00:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Recommended for Q2 incentive processing.", at("2026-03-01T12:10:00.000Z")),
      buildVerificationLogEntry("VERIFY", reviewerUsers.cseHead, "verified", "Verified and moved to the pending release batch.", at("2026-03-02T10:15:00.000Z")),
    ],
    contributors: [
      {
        user: facultyOne,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 70,
        selectorTags: ["FIRST_AUTHOR"],
      },
      {
        user: facultyTwo,
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        creditPercent: 30,
        selectorTags: [],
      },
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Submitted for pending reward batch scenario.", scoreAtAction: 25, createdAt: at("2026-02-28T09:00:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Recommended for Q2 incentive processing.", scoreAtAction: 25, createdAt: at("2026-03-01T12:10:00.000Z") },
      { action: "VERIFIED", actor: reviewerUsers.cseHead, actorRole: "Department Head", actorUnitName: cseUnit.name, note: "Verified and moved to the pending release batch.", scoreAtAction: 25, createdAt: at("2026-03-02T10:15:00.000Z") },
    ],
  });

  const releasedPublication = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: employeeAllocation.id,
    reporter: demoEmployee,
    state: "VERIFIED",
    title: "Seed R4.3 Released Publication",
    reportingDate: at("2026-03-03T12:45:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-03-01T00:00:00.000Z"),
    evidenceDescription: "Single-author released publication to exercise FULL_TO_SINGLE reward fallback.",
    evidenceLinks: ["https://example.com/r43/released-publication.pdf"],
    achievementFormData: {
      paperTitle: "Single Author Reward Release Example",
      journalName: "UGC Care Demonstration Journal",
      doi: "10.1000/seed-r43-released",
      indexing: ["UGC CARE List"],
      journalTier: "UGC_CARE",
      publicationDate: "2026-03-01",
      pdfLink: "https://example.com/r43/released-publication.pdf",
      ugcCareReference: "UGC-CARE-2026-001",
    },
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-03-02T16:20:00.000Z"),
    recommendationNote: "Single-author UGC paper cleared for release.",
    verifiedByUserId: reviewerUsers.cseHead.id,
    verifiedAt: at("2026-03-03T12:45:00.000Z"),
    verificationNote: "Verified and released as the single eligible contributor case.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", demoEmployee, "submitted", "Single-author UGC paper submitted.", at("2026-03-01T08:45:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Single-author UGC paper cleared for release.", at("2026-03-02T16:20:00.000Z")),
      buildVerificationLogEntry("VERIFY", reviewerUsers.cseHead, "verified", "Verified and released as the single eligible contributor case.", at("2026-03-03T12:45:00.000Z")),
    ],
    contributors: [
      {
        user: demoEmployee,
        contributorRoleId: roleMap.get("CORRESPONDING").id,
        creditPercent: 100,
        selectorTags: ["CORRESPONDING_AUTHOR"],
      },
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: demoEmployee, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Single-author UGC paper submitted.", scoreAtAction: 25, createdAt: at("2026-03-01T08:45:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Single-author UGC paper cleared for release.", scoreAtAction: 25, createdAt: at("2026-03-02T16:20:00.000Z") },
      { action: "VERIFIED", actor: reviewerUsers.cseHead, actorRole: "Department Head", actorUnitName: cseUnit.name, note: "Verified and released as the single eligible contributor case.", scoreAtAction: 25, createdAt: at("2026-03-03T12:45:00.000Z") },
    ],
  });

  const correctedPublication = await createSeedAchievement({
    tenant,
    period,
    kpi,
    allocationId: facultyAllocation.id,
    reporter: facultyOne,
    state: "VERIFIED",
    title: "Seed R4.3 Corrected Publication",
    reportingDate: at("2026-03-06T13:10:00.000Z"),
    actualValue: 1,
    actualDate: at("2026-03-02T00:00:00.000Z"),
    evidenceDescription: "Corrected after publisher reclassified the journal from Q1 to Q2.",
    evidenceLinks: ["https://example.com/r43/corrected-publication.pdf"],
    achievementFormData: {
      paperTitle: "Correction and Reward Recalculation Example",
      journalName: "Publisher Update Journal",
      doi: "10.1000/seed-r43-corrected",
      indexing: ["Scopus"],
      journalTier: "Q2",
      publicationDate: "2026-03-02",
      pdfLink: "https://example.com/r43/corrected-publication.pdf",
    },
    recommendedByUserId: reviewerUsers.eceHead.id,
    recommendedAt: at("2026-03-04T11:45:00.000Z"),
    recommendationNote: "Originally cleared as Q1; corrected later after publisher update.",
    verifiedByUserId: reviewerUsers.cseHead.id,
    verifiedAt: at("2026-03-06T13:10:00.000Z"),
    verificationNote: "Verified with corrected tier after published errata.",
    verificationLog: [
      buildVerificationLogEntry("SUBMIT", facultyOne, "submitted", "Submitted before the publisher errata was issued.", at("2026-03-03T10:15:00.000Z")),
      buildVerificationLogEntry("RECOMMEND", reviewerUsers.eceHead, "recommended", "Originally cleared as Q1; corrected later after publisher update.", at("2026-03-04T11:45:00.000Z")),
      buildVerificationLogEntry("VERIFY", reviewerUsers.cseHead, "verified", "Verified with corrected tier after published errata.", at("2026-03-06T13:10:00.000Z")),
    ],
    contributors: [
      {
        user: facultyOne,
        contributorRoleId: roleMap.get("LEAD_AUTHOR").id,
        creditPercent: 70,
        selectorTags: ["FIRST_AUTHOR"],
      },
      {
        user: facultyTwo,
        contributorRoleId: roleMap.get("CO_AUTHOR").id,
        creditPercent: 30,
        selectorTags: [],
      },
    ],
    trailEntries: [
      { action: "SUBMITTED", actor: facultyOne, actorRole: "Employee", actorUnitName: cseUnit.name, note: "Submitted before the publisher errata was issued.", scoreAtAction: 25, createdAt: at("2026-03-03T10:15:00.000Z") },
      { action: "RECOMMENDED", actor: reviewerUsers.eceHead, actorRole: "Department Head", actorUnitName: eceUnit.name, note: "Originally cleared as Q1; corrected later after publisher update.", scoreAtAction: 25, createdAt: at("2026-03-04T11:45:00.000Z") },
      { action: "VERIFIED", actor: reviewerUsers.cseHead, actorRole: "Department Head", actorUnitName: cseUnit.name, note: "Initially verified and released before the publisher corrected the tier.", scoreAtAction: 25, createdAt: at("2026-03-06T13:10:00.000Z") },
      {
        action: "CORRECTED",
        actor: owner,
        actorRole: "Tenant Owner",
        actorUnitName: cseUnit.name,
        note: "Publisher errata reclassified the journal from Q1 to Q2.",
        scoreAtAction: 25,
        metadata: {
          changedFieldKeys: ["journalTier", "evidenceDescription"],
          beforeAfterSummary: {
            journalTier: { before: "Q1", after: "Q2" },
            evidenceDescription: {
              before: "Initially verified before the publisher correction.",
              after: "Corrected after publisher reclassified the journal from Q1 to Q2.",
            },
          },
        },
        createdAt: at("2026-03-15T11:00:00.000Z"),
      },
      {
        action: "REWARD_REVOKED",
        actor: owner,
        actorRole: "Tenant Owner",
        actorUnitName: cseUnit.name,
        note: "Earlier released Q1 incentive revoked because the tier changed.",
        metadata: { oldState: "RELEASED", newState: "REVOKED" },
        createdAt: at("2026-03-15T11:30:00.000Z"),
      },
      {
        action: "REWARD_RECALCULATED",
        actor: owner,
        actorRole: "Tenant Owner",
        actorUnitName: cseUnit.name,
        note: "Replacement Q2 reward draft generated after correction.",
        metadata: { changedFieldKeys: ["journalTier"], oldState: "RELEASED", newState: "DRAFT" },
        createdAt: at("2026-03-15T11:45:00.000Z"),
      },
    ],
  });

  await createRewardRowsForAchievement({
    tenant,
    period,
    kpi,
    achievement: draftRewardsPublication.achievement,
    contributors: draftRewardsPublication.contributors,
    componentMap,
    tierMap,
    unitSnapshotByUserId,
    reporterUnit: cseSnapshot,
    owner,
    scenarioKey: "draft-rewards",
    tierCode: "Q1",
    stateByComponentCode: { Q1_MONETARY: "DRAFT", Q1_LEAVE_POINTS: "DRAFT" },
  });

  const pendingRewardRows = await createRewardRowsForAchievement({
    tenant,
    period,
    kpi,
    achievement: pendingRewardsPublication.achievement,
    contributors: pendingRewardsPublication.contributors,
    componentMap,
    tierMap,
    unitSnapshotByUserId,
    reporterUnit: cseSnapshot,
    owner,
    scenarioKey: "pending-rewards",
    tierCode: "Q2",
    stateByComponentCode: { Q2_MONETARY: "PENDING", Q2_LEAVE_POINTS: "PENDING" },
    stateNoteByComponentCode: {
      Q2_MONETARY: "Queued for March incentive release batch.",
      Q2_LEAVE_POINTS: "Queued for March incentive release batch.",
    },
  });

  const releasedRewardRows = await createRewardRowsForAchievement({
    tenant,
    period,
    kpi,
    achievement: releasedPublication.achievement,
    contributors: releasedPublication.contributors,
    componentMap,
    tierMap,
    unitSnapshotByUserId,
    reporterUnit: cseSnapshot,
    owner,
    scenarioKey: "released-rewards",
    tierCode: "UGC_CARE",
    stateByComponentCode: {
      UGC_CARE_MONETARY: "RELEASED",
      UGC_CARE_LEAVE_POINTS: "RELEASED",
    },
    stateNoteByComponentCode: {
      UGC_CARE_MONETARY: "Released in seeded disbursement run.",
      UGC_CARE_LEAVE_POINTS: "Released in seeded disbursement run.",
    },
    releaseReferenceByComponentCode: {
      UGC_CARE_MONETARY: "SEED-R43-REL-UGC-001",
      UGC_CARE_LEAVE_POINTS: "SEED-R43-REL-UGC-001",
    },
  });

  const revokedOriginalRows = await createRewardRowsForAchievement({
    tenant,
    period,
    kpi,
    achievement: correctedPublication.achievement,
    contributors: correctedPublication.contributors,
    componentMap,
    tierMap,
    unitSnapshotByUserId,
    reporterUnit: cseSnapshot,
    owner,
    scenarioKey: "corrected-original",
    tierCode: "Q1",
    stateByComponentCode: { Q1_MONETARY: "REVOKED", Q1_LEAVE_POINTS: "REVOKED" },
    stateNoteByComponentCode: {
      Q1_MONETARY: "Originally released before the journal was reclassified.",
      Q1_LEAVE_POINTS: "Originally released before the journal was reclassified.",
    },
    releaseReferenceByComponentCode: {
      Q1_MONETARY: "SEED-R43-REL-Q1-ERRATA",
      Q1_LEAVE_POINTS: "SEED-R43-REL-Q1-ERRATA",
    },
    revokedReasonByComponentCode: {
      Q1_MONETARY: "Publisher errata changed the eligible tier from Q1 to Q2.",
      Q1_LEAVE_POINTS: "Publisher errata changed the eligible tier from Q1 to Q2.",
    },
  });

  const supersedesByComponentCode = {
    Q2_MONETARY: new Map(),
    Q2_LEAVE_POINTS: new Map(),
  };
  for (const [key, reward] of revokedOriginalRows.entries()) {
    if (key.startsWith("Q1_MONETARY:")) {
      supersedesByComponentCode.Q2_MONETARY.set(key.split(":")[1], reward.id);
    } else if (key.startsWith("Q1_LEAVE_POINTS:")) {
      supersedesByComponentCode.Q2_LEAVE_POINTS.set(key.split(":")[1], reward.id);
    }
  }

  const replacementRows = await createRewardRowsForAchievement({
    tenant,
    period,
    kpi,
    achievement: correctedPublication.achievement,
    contributors: correctedPublication.contributors,
    componentMap,
    tierMap,
    unitSnapshotByUserId,
    reporterUnit: cseSnapshot,
    owner,
    scenarioKey: "corrected-replacement",
    tierCode: "Q2",
    stateByComponentCode: { Q2_MONETARY: "DRAFT", Q2_LEAVE_POINTS: "DRAFT" },
    stateNoteByComponentCode: {
      Q2_MONETARY: "Replacement reward awaiting release after correction.",
      Q2_LEAVE_POINTS: "Replacement reward awaiting release after correction.",
    },
    supersedesByComponentCode,
    replacementMode: true,
  });

  const normalizedOriginalMap = new Map();
  for (const [key, value] of revokedOriginalRows.entries()) {
    if (key.startsWith("Q1_MONETARY:")) {
      normalizedOriginalMap.set(`Q2_MONETARY:${key.split(":")[1]}`, value);
    } else if (key.startsWith("Q1_LEAVE_POINTS:")) {
      normalizedOriginalMap.set(`Q2_LEAVE_POINTS:${key.split(":")[1]}`, value);
    }
  }
  await linkReplacementRewards({
    revokedRows: normalizedOriginalMap,
    replacementRows,
  });

  const rewardNotificationRows = [];
  for (const [, reward] of [...pendingRewardRows.entries()].filter(([key]) => key.startsWith("Q2_MONETARY:"))) {
    if (!reward.contributorUserId) continue;
    rewardNotificationRows.push({
      tenantId: tenant.id,
      userId: reward.contributorUserId,
      type: "REWARD_PENDING",
      eventKey: makeSeedEventKey(`reward-pending:${reward.contributorUserId}`),
      title: "Reward marked pending",
      message: `${R43_PUBLICATION_KPI_TITLE} reward is pending release.`,
      entityType: "ContributorReward",
      entityId: reward.id,
      linkUrl: "/tenant-admin/kra-kpi",
      createdAt: at("2026-03-04T09:20:00.000Z"),
    });
  }
  for (const [, reward] of [...releasedRewardRows.entries()].filter(([key]) => key.startsWith("UGC_CARE_MONETARY:"))) {
    if (!reward.contributorUserId) continue;
    rewardNotificationRows.push({
      tenantId: tenant.id,
      userId: reward.contributorUserId,
      type: "REWARD_RELEASED",
      eventKey: makeSeedEventKey(`reward-released:${reward.contributorUserId}`),
      title: "Reward released",
      message: `${R43_PUBLICATION_KPI_TITLE} reward has been released.`,
      entityType: "ContributorReward",
      entityId: reward.id,
      linkUrl: "/tenant-admin/kra-kpi",
      createdAt: at("2026-03-05T10:05:00.000Z"),
    });
  }
  for (const [, reward] of [...revokedOriginalRows.entries()].filter(([key]) => key.startsWith("Q1_MONETARY:"))) {
    if (!reward.contributorUserId) continue;
    rewardNotificationRows.push({
      tenantId: tenant.id,
      userId: reward.contributorUserId,
      type: "REWARD_REVOKED",
      eventKey: makeSeedEventKey(`reward-revoked:${reward.contributorUserId}`),
      title: "Reward revoked",
      message: `${R43_PUBLICATION_KPI_TITLE} reward was revoked after a verified correction.`,
      entityType: "ContributorReward",
      entityId: reward.id,
      linkUrl: "/tenant-admin/kra-kpi",
      createdAt: at("2026-03-15T11:35:00.000Z"),
    });
  }

  await createSeedNotifications([
    {
      tenantId: tenant.id,
      userId: reviewerUsers.eceHead.id,
      type: "ACHIEVEMENT_SUBMITTED",
      eventKey: makeSeedEventKey("achievement-submitted:pending-recommendation"),
      title: "Achievement submitted for review",
      message: `${userName(facultyOne)} resubmitted a publication that needs recommendation.`,
      entityType: "Achievement",
      entityId: pendingRecommendation.achievement.id,
      linkUrl: "/my-kpis",
      createdAt: at("2026-02-12T09:01:00.000Z"),
    },
    {
      tenantId: tenant.id,
      userId: reviewerUsers.cseHead.id,
      type: "ACHIEVEMENT_RECOMMENDED",
      eventKey: makeSeedEventKey("achievement-recommended:pending-verification"),
      title: "Achievement recommended for verification",
      message: `${userName(demoEmployee)} has a publication waiting for final verification.`,
      entityType: "Achievement",
      entityId: pendingVerification.achievement.id,
      linkUrl: "/my-kpis",
      createdAt: at("2026-02-14T10:35:00.000Z"),
    },
    {
      tenantId: tenant.id,
      userId: facultyOne.id,
      type: "ACHIEVEMENT_REJECTED",
      eventKey: makeSeedEventKey("achievement-rejected:rejected-publication"),
      title: "Achievement rejected",
      message: "Your publication was rejected. Please upload the publisher confirmation letter and corrected DOI.",
      entityType: "Achievement",
      entityId: rejectedPublication.achievement.id,
      linkUrl: "/my-kpis",
      createdAt: at("2026-01-28T14:05:00.000Z"),
    },
    {
      tenantId: tenant.id,
      userId: facultyOne.id,
      type: "ACHIEVEMENT_CORRECTED",
      eventKey: makeSeedEventKey("achievement-corrected:corrected-publication"),
      title: "Verified achievement corrected",
      message: "A verified publication was corrected after the journal tier changed from Q1 to Q2.",
      entityType: "Achievement",
      entityId: correctedPublication.achievement.id,
      linkUrl: "/my-kpis",
      createdAt: at("2026-03-15T11:46:00.000Z"),
    },
    ...rewardNotificationRows,
  ]);

  return {
    kpi,
    allocations: [parentAllocation, facultyAllocation, employeeAllocation],
    achievements: [
      pendingRecommendation.achievement,
      pendingVerification.achievement,
      rejectedPublication.achievement,
      draftRewardsPublication.achievement,
      pendingRewardsPublication.achievement,
      releasedPublication.achievement,
      correctedPublication.achievement,
    ],
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

  const { cseUnit, eceUnit } = await ensurePublishedStructure(tenant.id, owner.id);
  if (!cseUnit || !eceUnit) {
    throw new Error("Seed structure did not create the CSE/ECE units.");
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
  await ensurePrimaryUnitAssignment({
    versionId: cseUnit.versionId,
    unitId: cseUnit.id,
    userId: facultyOne.id,
  });
  await ensurePrimaryUnitAssignment({
    versionId: eceUnit.versionId,
    unitId: eceUnit.id,
    userId: facultyTwo.id,
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
  const reviewerUsers = await ensureReviewerUsers({
    tenant,
    owner,
    cseUnit,
    eceUnit,
  });
  const r43Data = await ensureR43InterfaceSeed({
    tenant,
    owner,
    facultyOne,
    facultyTwo,
    demoEmployee,
    cseUnit,
    eceUnit,
    period: demoData.period,
    kra: demoData.kra,
    reviewerUsers,
  });

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
    reviewers: {
      cseHeadEmail: reviewerUsers.cseHead.officialEmail,
      eceHeadEmail: reviewerUsers.eceHead.officialEmail,
      demoPassword: DEMO_PASSWORD,
    },
    seededPeriodCode: demoData.period.code,
    seededKra: demoData.kra.title,
    seededKpi: demoData.kpi.title,
    allocationCount: demoData.allocations.length,
    r43WorkflowSeed: {
      kpiTitle: r43Data.kpi.title,
      seededAchievements: r43Data.achievements.length,
      seededAllocations: r43Data.allocations.length,
      statesCovered: ["SUBMITTED", "RECOMMENDED", "REJECTED", "VERIFIED"],
      rewardStatesCovered: ["DRAFT", "PENDING", "RELEASED", "REVOKED"],
      scenarios: [
        "Pending recommendation with resubmission trail",
        "Pending verification",
        "Rejected with remarks",
        "Verified with draft rewards",
        "Verified with pending rewards",
        "Released single-author reward",
        "Corrected verified achievement with revoke-and-replace rewards",
      ],
    },
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
